import { postableMoment } from "@elixir-mcp/posts/moment";
import { useId, useState } from "react";
import {
  Avatar,
  CardArt,
  DeckRow,
  Icon,
  Link,
  PlayerName,
  TagText,
  useClock,
} from "@elixir-mcp/ui";
import { playerHref } from "../lib/player.js";
import { accountHref, accountOf } from "../lib/account.js";
import {
  feedRows,
  groupSaid,
  modeWord,
  momentSaid,
  momentsSaid,
  shownAt,
} from "./logic.js";
import { FollowButton } from "./follow.jsx";
import {
  evidenceWord,
  sessionHeadline,
  sessionLink,
  sessionLinkName,
  Sitting,
  SITTINGS,
  sittingCard,
  trophyNet,
} from "./Session.jsx";
import { signedCount } from "@elixir-mcp/ui/session-story";
import { cheerCounts } from "./cheer-set.js";
import { MilestonePost, PostActions, PostBody } from "./Post.jsx";
import { ItemActions } from "./ItemActions.jsx";
import { RacePlace } from "./RacePlace.jsx";

/**
 * One feed item as the Timeline and Clan's Feed both draw it (2026-11-17:
 * one component, so the two cannot drift), and a day's rows in the feed's
 * rhythm (`FeedRows`): a big session keeps its card, a short one is one
 * line, and short sessions in a row fold into one group row that opens in
 * place. Moments carry their art: a card's own art (never altered), a kit
 * mark for an Arena or a league, the clan's mark for a clan's line; a new
 * best, a new league and a new Arena read as the day's headline.
 */
/** Who an item is about: the player it names, else its clan, else you. */
function subjectOf(it) {
  const player =
    (it.subjects ?? []).find((s) => s.kind === "player") ??
    (it.facts?.player_tag
      ? { tag: it.facts.player_tag, name: it.facts.name ?? null }
      : null);
  if (player) return { ...player, kind: "player" };
  const clan = (it.subjects ?? []).find((s) => s.kind === "clan");
  if (clan) return { ...clan, name: clan.name ?? it.subject_name ?? clan.tag };
  return null;
}

/** Who an item is about, as the feed names them: a player's game name opens
 *  their page; a clan's line names the clan; the account's own items are
 *  yours. Never a nickname here: the sentence below says it the way the
 *  timeline does. */
function Who({ who, close = false, plain = false }) {
  if (who?.kind === "player") {
    if (plain)
      return (
        <span className="kit-feed__name">
          <TagText>{who.name ?? who.tag}</TagText>
        </span>
      );
    const name = (
      <Link to={playerHref(who.tag)} className="kit-feed__name">
        <PlayerName tag={who.tag}>
          <TagText>{who.name ?? who.tag}</TagText>
        </PlayerName>
      </Link>
    );
    return close ? (
      <span className="kit-feed__namerow">
        {name}
        <CloseMark />
      </span>
    ) : (
      name
    );
  }
  if (who)
    return (
      <span className="kit-feed__name">
        <TagText>{who.name}</TagText>
      </span>
    );
  return <span className="kit-feed__name">You</span>;
}

const isClanLine = (it) =>
  (it.subjects ?? []).length > 0 &&
  (it.subjects ?? []).every((s) => s.kind === "clan");

/** A clan's own item, or a member's coming, going or role in it: these wear
 *  the clan's band and gold edge (canvas .item.clan). */
const CLAN_MEMBER_KINDS = new Set([
  "member_joined",
  "member_left",
  "member_role_changed",
]);
const isClanItem = (it) =>
  isClanLine(it) ||
  (CLAN_MEMBER_KINDS.has(it.kind) &&
    (it.subjects ?? []).some((s) => s.kind === "clan"));

/** The word after the clan's name on its band. */
const BAND_WORDS = {
  member_joined: "arrival",
  member_left: "departure",
  member_role_changed: "role",
  race_finished: "Clan Wars",
  week_resolved: "Clan Wars",
  bracket_observed: "Clan Wars",
};

/** A moment's medal, for a moment with no art of its own. */
const VIOLET = new Set([
  "card_unlocked",
  "card_form_unlocked",
  "card_maxed",
  "card_first_win",
]);

/** The moments that read as the day's headline (2026-11-17): a new best, a
 *  new league in Ranked, a new Arena. An Arena move down is a moment, not a
 *  headline (the syndication's rule, story-context.mjs). */
const HEADLINES = new Set([
  "best_trophies_band",
  "ranked_promotion",
  "arena_changed",
]);
const isHeadline = (it) =>
  HEADLINES.has(it.kind) &&
  !(it.kind === "arena_changed" && it.facts?.to < it.facts?.from);

/** A starred friend's item: the owner's own mark, which nobody else sees
 *  (the server sends `close` in groups to the account that starred them). */
const isClose = (it) => (it.groups ?? []).includes("close");

/** The small star beside a close friend's name, as their page draws it
 *  (close.jsx): private to the account that starred them. */
function CloseMark() {
  return (
    <span className="kit-feed__close" title="Close friend. Only you see this.">
      <Icon name="star" size={12} />
      <span className="sr-only">Close friend</span>
    </span>
  );
}

/** The facts a moment names its proving battle under, in the feed's order
 *  (services/web-api/src/feed.mjs PROOFS). */
const PROOFS = ["promoted_by", "crossed_by", "best_win"];

/** A moment's battle, as its line under the moment (canvas .mbattle): the
 *  result and score when the record names them, and one way in. */
function MomentBattle({ it }) {
  const by = PROOFS.map((k) => it.facts?.[k]).find((p) => p?.battle_id) ?? null;
  const known =
    by &&
    typeof by.crowns === "number" &&
    typeof by.crowns_against === "number";
  const won = known && by.crowns > by.crowns_against;
  // The line under the result (canvas .mbattle's note): the battle's mode,
  // and its trophies after when the record kept them. Facts only.
  const context = [
    it.proof_mode ? modeWord(it.proof_mode) : null,
    typeof by?.trophies_after === "number" && it.proof_mode === "ladder"
      ? `${by.trophies_after.toLocaleString("en-US")} trophies after`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Link
      to={it.battle_url.replace(/^https?:\/\/[^/]+/, "")}
      className="kit-mbattle"
    >
      {known ? (
        <>
          <span
            className={`kit-mbattle__res kit-mbattle__res--${won ? "won" : "lost"}`}
          >
            {won ? "Won" : "Lost"}
          </span>
          <span className="kit-mbattle__line">
            <b>
              {by.crowns}-{by.crowns_against}
              {by.opponent?.name ? (
                <>
                  {won ? " over " : " against "}
                  <TagText>{by.opponent.name}</TagText>
                </>
              ) : null}
            </b>
            {context ? (
              <span className="kit-mbattle__note">{context}</span>
            ) : null}
          </span>
        </>
      ) : null}
      <span className="kit-mbattle__go">Open the battle</span>
    </Link>
  );
}

/** When an item happened, as the feed says it ("Tonight, 7:40 to 8:32 pm"),
 *  with the exact instant for a pointer and a screen reader. A sitting
 *  shows its range. */
function When({ it }) {
  const { feedWhen, when } = useClock();
  const f = it.facts ?? {};
  const range = SITTINGS.has(it.kind) && f.started_at && f.ended_at;
  const at = range ? f.started_at : shownAt(it);
  if (!at) return null;
  return (
    <time
      className="kit-feed__time"
      dateTime={at}
      title={range ? `${when(f.started_at)} to ${when(f.ended_at)}` : when(at)}
    >
      {range ? feedWhen(f.started_at, f.ended_at) : feedWhen(at)}
    </time>
  );
}

export function FeedItem({
  it,
  open = false,
  onToggle = null,
  cheerWhere = undefined,
  publicView = false,
  commentEntry = null,
}) {
  const sitting = SITTINGS.has(it.kind);
  const clan = isClanItem(it);
  const who = subjectOf(it);
  const clanSubject = clan
    ? (it.subjects ?? []).find((s) => s.kind === "clan")
    : null;
  const post = it.kind === "post";
  // A post about a battle is a post (0292); the record's own line for one
  // (kind battle_highlight) is drawn as its sentence where a page still
  // holds it (a battle's cheers), never as a moment.
  const moment = !sitting && !clan && !post && it.kind !== "battle_highlight";
  const band = BAND_WORDS[it.kind];
  const card = sittingCard(it);
  const sessionTo = card
    ? sessionLink(it, who?.kind === "player" ? who.tag : null)
    : null;
  const text = (
    <p className="kit-feed__text">
      <TagText>{it.text}</TagText>
    </p>
  );
  const links = (
    <>
      {it.battle_url && !moment ? (
        <Link
          to={it.battle_url.replace(/^https?:\/\/[^/]+/, "")}
          className="btn btn--sm"
        >
          Open battle
        </Link>
      ) : null}
      {accountOf(it) ? (
        <Link to={accountHref(accountOf(it))} className="btn btn--sm">
          Open their account
        </Link>
      ) : null}
      {/* A sitting opens its own page (2026-11-16): the card is the
          link. A moment's crossing, and a sitting with no page to open,
          still open in place. */}
      {it.evidence && !sessionTo && onToggle ? (
        <button
          type="button"
          className="btn btn--sm"
          aria-expanded={open}
          onClick={onToggle}
        >
          {evidenceWord(it, open)}
        </button>
      ) : null}
    </>
  );
  return (
    <article
      className={`kit-feed__item${clan ? " kit-feed__item--clan" : ""}${moment && isHeadline(it) ? " kit-feed__item--headline" : ""}`}
    >
      {clanSubject ? (
        <p className="kit-feed__band">
          <Avatar
            name={clanSubject.name ?? it.subject_name ?? clanSubject.tag}
            tag={clanSubject.tag}
            clan
            small
          />
          <TagText>
            {clanSubject.name ?? it.subject_name ?? clanSubject.tag}
          </TagText>
          {band ? ` · ${band}` : null}
        </p>
      ) : null}
      <header className="kit-feed__head">
        <Avatar
          name={who?.name ?? who?.tag ?? "You"}
          tag={who?.tag}
          card={who?.kind === "player" ? (it.avatar_card_id ?? null) : null}
          clan={who ? who.kind !== "player" : false}
        />
        <div className="kit-feed__who">
          <Who
            who={who}
            close={!publicView && isClose(it)}
            plain={publicView}
          />
          <When it={it} />
        </div>
        {!publicView && it.offer_follow && who?.kind === "player" ? (
          // A clan arrival you do not follow (canvas .ih .follow): the one
          // Follow, asked first, priced when its dialog opens.
          <FollowButton tag={who.tag} name={who.name} lazy />
        ) : null}
      </header>
      {post ? (
        <PostBody it={it} />
      ) : moment ? (
        <MomentBody it={it} text={text} />
      ) : card ? (
        <Sitting
          it={it}
          href={publicView ? null : sessionTo}
          who={who?.kind === "player" ? (who.name ?? who.tag) : null}
        />
      ) : (
        text
      )}
      {it.kind === "week_resolved" ? <RacePlace rank={it.facts?.rank} /> : null}
      {moment && it.battle_url && !publicView ? <MomentBattle it={it} /> : null}
      {post && !publicView ? <PostActions it={it} /> : null}
      {!publicView && postableMoment(it) ? (
        <MilestonePost key={it.id} it={it} />
      ) : null}
      {!publicView ? (
        <>
          <div className="kit-feed__links">{links}</div>
          <ItemActions
            it={it}
            cheerWhere={cheerWhere}
            commentEntry={commentEntry}
          />
        </>
      ) : null}
    </article>
  );
}

const FORM_WORD = { evolution: "New Evo", hero: "New Hero" };
const FIRST_WIN_FORM = { evolution: "Evo", hero: "Hero" };
/** A deck switch's kicker names its mode: modes are different games. */
const SWITCH_KICKER = {
  ladder: "New deck on Trophy Road",
  ranked: "New deck in Ranked",
  war: "New deck in Clan Wars",
};

/** What a moment's head says above its sentence (2026-11-17), from its
 *  facts only; null when the facts do not say it. */
export function momentHead(it) {
  const f = it.facts ?? {};
  switch (it.kind) {
    case "best_trophies_band":
      return typeof f.best === "number"
        ? {
            kicker: "New best",
            title: `${f.best.toLocaleString("en-US")} trophies`,
          }
        : null;
    case "ranked_promotion":
      return f.to_name
        ? { kicker: "New league in Ranked", title: f.to_name }
        : null;
    case "arena_changed":
      return f.to_name && isHeadline(it)
        ? { kicker: "New Arena", title: f.to_name }
        : null;
    case "card_unlocked":
      return f.card ? { kicker: "New card", title: f.card } : null;
    case "card_form_unlocked":
      return f.card && FORM_WORD[f.form]
        ? { kicker: FORM_WORD[f.form], title: f.card }
        : null;
    case "card_maxed":
      return f.card ? { kicker: "Maxed", title: f.card } : null;
    // The first win with a new card, form or tower troop (0289), named
    // as a deck slot shows it.
    case "card_first_win":
      return f.card
        ? {
            kicker: "First win",
            title: FIRST_WIN_FORM[f.form]
              ? `${FIRST_WIN_FORM[f.form]} ${f.card}`
              : f.card,
          }
        : null;
    case "king_tower_leveled":
      return typeof f.level === "number"
        ? { kicker: "King Tower", title: `Level ${f.level}` }
        : null;
    case "challenge_best_run":
      return typeof f.best === "number"
        ? { kicker: "Best challenge run", title: `${f.best} wins` }
        : null;
    case "twelve_win_run":
      return f.challenge ? { kicker: "12 wins", title: f.challenge } : null;
    case "deck_switched":
      return f.deck
        ? { kicker: SWITCH_KICKER[f.mode] ?? "New deck", title: f.deck }
        : null;
    // The league only; a rating only in Ultimate Champion, as its
    // sentence says it (0289). Never a rank.
    case "ranked_season_finished":
      return f.league_name
        ? {
            kicker: "Ranked season",
            title:
              typeof f.rating === "number"
                ? `${f.league_name} · ${f.rating.toLocaleString("en-US")}`
                : f.league_name,
          }
        : null;
    // A war week (13.10.0): the week's decks, never a day and never fame.
    case "war_week_played":
      return typeof f.decks_used === "number"
        ? {
            kicker: `Clan Wars week ${(f.section_index ?? 0) + 1}`,
            title: `${f.decks_used} ${f.decks_used === 1 ? "deck" : "decks"}`,
          }
        : null;
    case "badge_earned":
      if (Array.isArray(f.badges) && f.badges.length > 1)
        return {
          kicker: "Card Mastery",
          title: `${f.badge_count ?? f.badges.length} cards`,
        };
      if (f.badge === "YearsPlayed" && typeof f.level === "number")
        return {
          kicker: "Years played",
          title: `${f.level} ${f.level === 1 ? "year" : "years"}`,
        };
      return it.moment_card?.name
        ? { kicker: "Card Mastery", title: it.moment_card.name }
        : null;
    case "legendary_badge_earned":
      return it.moment_card?.name
        ? { kicker: "Card Mastery", title: it.moment_card.name }
        : null;
    default:
      return null;
  }
}

/** The card a moment names, for its art: a new or maxed card, a form, a
 *  Mastery badge's card (moment_card); null for any other. */
function momentCardOf(it) {
  const f = it.facts ?? {};
  if (it.kind === "drop_game") return f.cards?.[0] ?? null;
  return (it.kind === "card_unlocked" || it.kind === "card_maxed") && f.card_id
    ? { id: f.card_id, name: f.card ?? "" }
    : it.kind === "card_form_unlocked" && f.card_id && FORM_WORD[f.form]
      ? { id: f.card_id, name: f.card ?? "", form: f.form }
      : it.kind === "card_first_win" && f.card_id
        ? {
            id: f.card_id,
            name: f.card ?? "",
            ...(FIRST_WIN_FORM[f.form] ? { form: f.form } : {}),
          }
        : it.moment_card?.id
          ? { id: it.moment_card.id, name: it.moment_card.name }
          : (it.moment_cards?.[0] ?? null);
}

/** A badge's own art (0288, 2026-11-17, the owner: "Yes use badge
 *  art. For sure."): the mirror's unaltered copy of the game's icon,
 *  sized by CSS width alone (never tinted, cropped or covered). A file
 *  the mirror has not copied yet draws what the moment drew before. */
function BadgeArt({ src, className, children }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return children;
  return (
    <span className={className}>
      <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
    </span>
  );
}

/** A moment's art (2026-11-17): the badge's own art for a badge it
 *  tells (badge_art), the card's own art for a card it names
 *  (never tinted, cropped or covered: the kit's CardArt draws it whole,
 *  its form's ribbon included), a day's Mastery cards side by side, a kit
 *  mark for an Arena or a league (Elixir has no Arena art, and invents
 *  none), else the medal. */
export function MomentArt({ it }) {
  if ((it.moment_cards?.length ?? 0) > 1) return <MomentArtDrawn it={it} />;
  return (
    <BadgeArt src={it.badge_art} className="kit-mart kit-mart--badge">
      <MomentArtDrawn it={it} />
    </BadgeArt>
  );
}

function MomentArtDrawn({ it }) {
  if ((it.moment_cards?.length ?? 0) > 1)
    return (
      <span className="kit-mart kit-mart--cards">
        {it.moment_cards.map((c) => (
          <CardArt key={c.id} card={c} size={40} showLevel={false} />
        ))}
      </span>
    );
  const cardOf = momentCardOf(it);
  if (cardOf)
    return (
      <span className="kit-mart kit-mart--card">
        <CardArt card={cardOf} size={56} showLevel={false} />
      </span>
    );
  const mark =
    it.kind === "arena_changed"
      ? "castle"
      : it.kind === "ranked_promotion" || it.kind === "ranked_season_finished"
        ? "crown"
        : it.kind === "best_trophies_band"
          ? "award"
          : null;
  if (mark)
    return (
      <span className="kit-mart kit-mart--mark" aria-hidden="true">
        <Icon name={mark} size={28} />
      </span>
    );
  return (
    <span
      className={`kit-medal${VIOLET.has(it.kind) ? " kit-medal--violet" : ""}`}
      aria-hidden="true"
    >
      <Icon name="star" size={26} />
    </span>
  );
}

/** A moment's body: its art, its head when the facts give one, and the
 *  timeline's own sentence, which keeps the detail (from where, which
 *  level). */
function MomentBody({ it, text }) {
  const head = momentHead(it);
  // A deck switch shows its deck (0289): the eight cards as a session's
  // deck row draws them, under the sentence, in place of a medal.
  if (it.kind === "deck_switched" && it.deck?.cards?.length)
    return (
      <div className="kit-feed__moment kit-feed__moment--deck">
        <div className="kit-moment__said">
          {head ? (
            <p className="kit-moment__head">
              <span className="kit-moment__kicker">{head.kicker}</span>
              <span className="kit-moment__title">
                <TagText>{head.title}</TagText>
              </span>
            </p>
          ) : null}
          {text}
        </div>
        <div className="kit-scard__deck">
          <DeckRow
            cards={it.deck.cards}
            showCost
            label={`${it.deck.label ?? "The deck"}, the new deck`}
          />
        </div>
      </div>
    );
  return (
    <div className="kit-feed__moment">
      <MomentArt it={it} />
      <div className="kit-moment__said">
        {head ? (
          <p className="kit-moment__head">
            <span className="kit-moment__kicker">{head.kicker}</span>
            <span className="kit-moment__title">
              <TagText>{head.title}</TagText>
            </span>
          </p>
        ) : null}
        {text}
      </div>
    </div>
  );
}

/** A short session as one line (2026-11-17): who and when, what happened
 *  with its trophies, and its cheers on the right. The line opens the
 *  session's page, as the card did; no deck art. */
function SessionLine({ it, inGroup = false, cheerWhere, commentEntry }) {
  const who = subjectOf(it);
  const f = it.facts ?? {};
  const name = who?.kind === "player" ? (who.name ?? who.tag) : null;
  const href = sessionLink(it, who?.kind === "player" ? who.tag : null);
  const net = trophyNet(f);
  const said = (
    <>
      <span>{sessionHeadline(f)}</span>
      {net !== null ? " " : null}
      {net !== null ? (
        <span
          className={`kit-line__net${net > 0 ? " kit-line__net--up" : net < 0 ? " kit-line__net--down" : ""}`}
        >
          {signedCount(net)} trophies
        </span>
      ) : null}
    </>
  );
  return (
    <article
      className={`kit-feed__item kit-feed__item--line${inGroup ? " kit-feed__item--in" : ""}`}
    >
      <Avatar
        name={who?.name ?? who?.tag ?? "You"}
        tag={who?.tag}
        card={who?.kind === "player" ? (it.avatar_card_id ?? null) : null}
        small
      />
      <div className="kit-line__main">
        <div className="kit-line__who">
          <Who who={who} close={isClose(it)} />
          <When it={it} />
        </div>
        {href ? (
          <Link
            to={href}
            className="kit-line__go"
            aria-label={sessionLinkName(f, name)}
          >
            {said}
          </Link>
        ) : (
          <p className="kit-line__go">{said}</p>
        )}
      </div>
      <ItemActions
        it={it}
        cheerWhere={cheerWhere}
        commentEntry={commentEntry}
      />
    </article>
  );
}

/** A small moment as one line (2026-11-17): who and when, a small mark
 *  (the card's own art when it names one), the sentence without the name
 *  the row already shows, and its cheers on the right. */
function MomentLine({ it, inGroup = false, cheerWhere, commentEntry }) {
  const who = subjectOf(it);
  const card = momentCardOf(it);
  return (
    <article
      className={`kit-feed__item kit-feed__item--line kit-feed__item--moment${inGroup ? " kit-feed__item--in" : ""}`}
    >
      <Avatar
        name={who?.name ?? who?.tag ?? "You"}
        tag={who?.tag}
        card={who?.kind === "player" ? (it.avatar_card_id ?? null) : null}
        small
      />
      <div className="kit-line__main">
        <div className="kit-line__who">
          <Who who={who} close={isClose(it)} />
          <When it={it} />
        </div>
        <p className="kit-line__go">
          <BadgeArt
            src={it.badge_art}
            className="kit-line__art kit-line__art--badge"
          >
            {card ? (
              <span className="kit-line__art">
                <CardArt card={card} size={24} showLevel={false} />
              </span>
            ) : (
              <span
                className="kit-line__art kit-line__art--mark"
                aria-hidden="true"
              >
                <Icon name="star" size={14} />
              </span>
            )}
          </BadgeArt>
          <span>
            <TagText>{momentSaid(it, who?.name ?? null)}</TagText>
          </span>
        </p>
      </div>
      {postableMoment(it) ? <MilestonePost key={it.id} it={it} /> : null}
      <ItemActions
        it={it}
        cheerWhere={cheerWhere}
        commentEntry={commentEntry}
      />
    </article>
  );
}

/** Small moments in a row, as one row that opens in place (2026-11-17),
 *  as short sessions fold: each moment inside keeps its own cheer. */
function MomentGroup({ rows, cheerWhere, commentEntry }) {
  const [open, setOpen] = useState(() =>
    rows.some(({ it }) => entryFor(commentEntry, it)),
  );
  const bodyId = useId();
  const items = rows.map((r) => r.it);
  const g = momentsSaid(items);
  const { feedWhen } = useClock();
  const first = shownAt(items.at(-1));
  const last = shownAt(items[0]);
  return (
    <div className={`kit-feed__group${open ? " kit-feed__group--open" : ""}`}>
      <button
        type="button"
        className="kit-group__toggle"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen(!open)}
      >
        <span className="kit-group__faces" aria-hidden="true">
          {g.people.slice(0, 3).map((p) => (
            <Avatar key={p.tag} name={p.name} tag={p.tag} small />
          ))}
        </span>
        <span className="kit-group__said">
          <span className="kit-group__title">
            <TagText>{g.title}</TagText>
          </span>
          <span className="kit-group__record">
            {first && last ? feedWhen(first, last) : null}
          </span>
        </span>
        <Icon name={open ? "chevron-up" : "chevron-down"} size={18} />
      </button>
      <div id={bodyId} className="kit-group__body" hidden={!open}>
        {open
          ? rows.map(({ it }, i) => (
              <MomentLine
                key={it.id ?? i}
                it={it}
                inGroup
                cheerWhere={cheerWhere}
                commentEntry={entryFor(commentEntry, it)}
              />
            ))
          : null}
      </div>
    </div>
  );
}

/** Short sessions in a row, as one row that opens in place (2026-11-17).
 *  The group itself takes no cheer: each session inside keeps its own, by
 *  its own id, once the group is open. Closed, it says how many cheers its
 *  sessions have between them, counts only. */
function SessionGroup({ rows, cheerWhere, commentEntry }) {
  const [open, setOpen] = useState(() =>
    rows.some(({ it }) => entryFor(commentEntry, it)),
  );
  const bodyId = useId();
  const items = rows.map((r) => r.it);
  const g = groupSaid(items);
  const { feedWhen } = useClock();
  const first = items.at(-1)?.facts?.started_at ?? shownAt(items.at(-1));
  const last = items[0]?.facts?.ended_at ?? shownAt(items[0]);
  const cheers = items.reduce(
    (n, it) => n + cheerCounts(it.cheers).reduce((m, c) => m + c.count, 0),
    0,
  );
  return (
    <div className={`kit-feed__group${open ? " kit-feed__group--open" : ""}`}>
      <button
        type="button"
        className="kit-group__toggle"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen(!open)}
      >
        <span className="kit-group__faces" aria-hidden="true">
          {g.people.slice(0, 3).map((p) => (
            <Avatar key={p.tag} name={p.name} tag={p.tag} small />
          ))}
        </span>
        <span className="kit-group__said">
          <span className="kit-group__title">
            <TagText>{g.title}</TagText>
          </span>
          <span className="kit-group__record">
            {g.record}
            {first && last ? ` · ${feedWhen(first, last)}` : null}
            {cheers > 0
              ? ` · ${cheers} ${cheers === 1 ? "cheer" : "cheers"}`
              : null}
          </span>
        </span>
        <Icon name={open ? "chevron-up" : "chevron-down"} size={18} />
      </button>
      <div id={bodyId} className="kit-group__body" hidden={!open}>
        {open
          ? rows.map(({ it }, i) => (
              <SessionLine
                key={it.id ?? i}
                it={it}
                inGroup
                cheerWhere={cheerWhere}
                commentEntry={entryFor(commentEntry, it)}
              />
            ))
          : null}
      </div>
    </div>
  );
}

/** The "New since your last visit" line, under the last new row. */
function NewMark() {
  return (
    <div className="kit-newmark">
      New since your last visit
      <span className="sr-only">: the items above this line.</span>
    </div>
  );
}

/**
 * A day's rows in the feed's rhythm (feedRows): big items as their card,
 * a short session as one line, short sessions in a row as one group.
 * `openId` and `onToggle` open an item's evidence in place, and `below(it)`
 * draws it; without `onToggle` (Clan's Feed) nothing opens in place.
 */
export function FeedRows({
  rows,
  openId = null,
  onToggle = null,
  below = null,
  cheerWhere = undefined,
  commentEntry = null,
}) {
  return feedRows(rows).map((row, i) => (
    <div key={row.it.id ?? i}>
      {row.type === "group" ? (
        <SessionGroup
          rows={row.rows}
          cheerWhere={cheerWhere}
          commentEntry={commentEntry}
        />
      ) : row.type === "line" ? (
        <SessionLine
          it={row.it}
          cheerWhere={cheerWhere}
          commentEntry={entryFor(commentEntry, row.it)}
        />
      ) : row.type === "moments" ? (
        <MomentGroup
          rows={row.rows}
          cheerWhere={cheerWhere}
          commentEntry={commentEntry}
        />
      ) : row.type === "moment" ? (
        <MomentLine
          it={row.it}
          cheerWhere={cheerWhere}
          commentEntry={entryFor(commentEntry, row.it)}
        />
      ) : (
        <FeedItem
          it={row.it}
          open={openId === row.it.id}
          onToggle={onToggle ? () => onToggle(row.it.id) : null}
          cheerWhere={cheerWhere}
          commentEntry={entryFor(commentEntry, row.it)}
        />
      )}
      {row.type === "item" && openId === row.it.id && below
        ? below(row.it)
        : null}
      {row.newLine ? <NewMark /> : null}
    </div>
  ));
}

const entryFor = (entry, it) =>
  entry && (!entry.itemId || entry.itemId === it.id) ? entry : null;
