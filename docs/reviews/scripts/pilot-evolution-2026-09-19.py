#!/usr/bin/env python3
"""Reproduces the numbers in docs/reviews/2026-09-19-PILOT-SCORE-EVOLUTION.md.

Input: the migrate Lambda's read-only `pilot_pairs` op, paged into two CSVs
(pairs.csv, players.csv) -- see the review for the invocation. Nothing here
touches the database. Needs numpy, pandas, scipy, scikit-learn.

    python3 pilot-evolution-2026-09-19.py /path/to/pairs.csv
"""

import sys

import numpy as np
import pandas as pd
import scipy.sparse as sp
from sklearn.linear_model import LogisticRegression

pairs_path = sys.argv[1] if len(sys.argv) > 1 else "pairs.csv"
p = pd.read_csv(pairs_path).sort_values(["bid", "player_tag"])
p["own_level"] = p.gap + p.opponent_level
print(f"rows {len(p)} matches {p.bid.nunique()} players {p.player_tag.nunique()}")

# --- 1. Structure: who is in the population -------------------------------
c = p.groupby("player_tag").size()
heavy = set(c[c >= 30].index)
p["heavy"] = p.player_tag.isin(heavy)
print(
    "players by battles: 1:", (c == 1).sum(), " 2-4:", ((c >= 2) & (c < 5)).sum(),
    " 5-29:", ((c >= 5) & (c < 30)).sum(), " >=30:", (c >= 30).sum(),
)
print("win rate heavy:", round(p[p.heavy].win.mean(), 3), " light:", round(p[~p.heavy].win.mean(), 3))
print(p.groupby("type").agg(n=("win", "size"), zero_gap=("gap", lambda g: (g == 0).mean())))

# --- 2. Matches as rows; does the opponent's trophy position predict? -----
a = p.groupby("bid").nth(0).set_index("bid")
o = p.groupby("bid").nth(1).set_index("bid")
m = a.join(o, rsuffix="_o")
m["tdiff"] = m.starting_trophies - m.starting_trophies_o
for typ in ["PvP", "pathOfLegend", "riverRacePvP"]:
    s = m[(m.type == typ) & m.tdiff.notna()]
    X = np.c_[s.tdiff / 100.0, s.gap]
    lr = LogisticRegression(fit_intercept=False, C=1e6).fit(X, s.win)
    print(
        f"{typ}: |tdiff| median {s.tdiff.abs().median():.0f}, p99 {s.tdiff.abs().quantile(.99):.0f}; "
        f"logit per 100 trophies {lr.coef_[0][0]:+.3f}, per deck level {lr.coef_[0][1]:+.3f}"
    )

# --- 3. Bradley-Terry on the Ranked recorded-vs-recorded graph -------------
r = m[
    (m.type == "pathOfLegend") & m.player_tag.isin(heavy) & m.player_tag_o.isin(heavy)
    & m.starting_trophies.notna() & m.starting_trophies_o.notna()
].sort_values("t")
players = pd.Index(pd.unique(r[["player_tag", "player_tag_o"]].values.ravel()))
idx = {t: i for i, t in enumerate(players)}
cut = int(len(r) * 0.7)
tr, te = r.iloc[:cut], r.iloc[cut:]


def design(df):
    n = len(df)
    rows = np.r_[np.arange(n), np.arange(n)]
    cols = np.r_[df.player_tag.map(idx).values, df.player_tag_o.map(idx).values]
    return sp.csr_matrix((np.r_[np.ones(n), -np.ones(n)], (rows, cols)), shape=(n, len(players)))


def logloss(y, pr):
    pr = np.clip(pr, 1e-6, 1 - 1e-6)
    return -np.mean(y * np.log(pr) + (1 - y) * np.log(1 - pr))


print(f"Ranked heavy-vs-heavy matches {len(r)}, players {len(players)}; baseline logloss {logloss(te.win, 0.5):.4f}")
lr = LogisticRegression(fit_intercept=False, C=1e6).fit(np.c_[(tr.starting_trophies - tr.starting_trophies_o) / 100], tr.win)
pr = lr.predict_proba(np.c_[(te.starting_trophies - te.starting_trophies_o) / 100])[:, 1]
print(f"game rating diff: logloss {logloss(te.win, pr):.4f} acc {((pr > .5) == te.win).mean():.3f}")
for C in (0.05, 0.2, 1.0):
    lr = LogisticRegression(fit_intercept=False, C=C, max_iter=2000).fit(design(tr), tr.win)
    pr = lr.predict_proba(design(te))[:, 1]
    print(f"Bradley-Terry ridge C={C}: logloss {logloss(te.win, pr):.4f} acc {((pr > .5) == te.win).mean():.3f}")

# --- 4. Position given levels: the ladder curve and lift -------------------
L = p[(p.type == "PvP") & p.starting_trophies.notna() & (p.starting_trophies < 14000)].copy()
X = np.c_[np.ones(len(L)), L.own_level, L.own_level**2]
b = np.linalg.lstsq(X, L.starting_trophies, rcond=None)[0]
L["lift"] = L.starting_trophies - X @ b
r2 = 1 - (L.lift**2).sum() / ((L.starting_trophies - L.starting_trophies.mean()) ** 2).sum()
print(f"ladder obs {len(L)}, players {L.player_tag.nunique()}; position curve R2 {r2:.3f}, resid SD {L.lift.std():.0f}")
L["month"] = pd.to_datetime(L.t, unit="s").dt.strftime("%Y-%m")
L["lvl_bin"] = (L.own_level * 2).round() / 2
print(L[L.lvl_bin.isin([15.0, 16.0])].pivot_table(index="month", columns="lvl_bin", values="starting_trophies", aggfunc="median").round(0))
g = L.groupby("player_tag").agg(n=("win", "size"), lift=("lift", "mean"), gap=("gap", "mean"), win=("win", "mean"))
g = g[g.n >= 20]
print(
    f"players >=20 ladder battles {len(g)}: corr(lift,-gap) {np.corrcoef(g.lift, -g.gap)[0,1]:.3f}, "
    f"corr(lift,win) {np.corrcoef(g.lift, g.win)[0,1]:.3f}, corr(lift, log n) {np.corrcoef(g.lift, np.log(g.n))[0,1]:.3f}"
)
L = L.sort_values(["player_tag", "t"])
L["half"] = (L.groupby("player_tag").cumcount() >= L.groupby("player_tag").win.transform("size") / 2).astype(int)
hh = L[L.player_tag.isin(g.index)].groupby(["player_tag", "half"]).agg(lift=("lift", "mean"), win=("win", "mean")).unstack()
for col in ("lift", "win"):
    print(f"first-half vs second-half corr {col}: {np.corrcoef(hh[(col, 0)], hh[(col, 1)])[0,1]:.3f}")

# --- 5. Margin of victory adds little -------------------------------------
q = p[~p.type.isin(["friendly", "clanMate", "unknown"])].copy()
q["cdiff"] = q.crowns - q.groupby("bid").crowns.transform(lambda s: s.iloc[::-1].values)
cq = q.groupby("player_tag").size()
q = q[q.player_tag.isin(cq[cq >= 60].index)].sort_values(["player_tag", "t"])
q["half"] = q.groupby("player_tag").cumcount() % 2
for col in ("win", "cdiff"):
    s = q.groupby(["player_tag", "half"])[col].mean().unstack()
    rr = np.corrcoef(s[0], s[1])[0, 1]
    print(f"split-half {col}: r={rr:.3f} (Spearman-Brown {2*rr/(1+rr):.3f})")
