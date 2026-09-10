import {
  Activity,
  ArrowRight,
  BookOpen,
  Bookmark,
  ChartColumn,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  CircleDashed,
  FileText,
  Gauge,
  HeartPulse,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Plug,
  Plus,
  Radar,
  Search,
  Server,
  Settings,
  Shield,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";

/**
 * The console's icons, from Lucide.
 *
 * The design draws the rail with Lucide and this is Lucide — the
 * package, not twenty glyphs copied out of it. The copies were a
 * dependency this app did not want, paid for in the currency it does not
 * want either: a set that goes stale the moment Lucide fixes a path, and
 * a wall a future screen has to climb to use a twenty-first icon.
 *
 * The wrapper stays, and it is doing three jobs worth keeping. It fixes
 * the stroke and size so a rail icon cannot arrive a different weight
 * from the one beside it. It keeps every icon `aria-hidden`: they are
 * decoration over a text label everywhere they appear and never carry
 * meaning on their own. And it takes the design's kebab-case names, so
 * `<Icon name="chart-column" />` reads the same as the design file it
 * came from.
 *
 * To add one: import it and add the line. Lucide's own name, in kebab
 * case, is the key.
 */
const ICONS = {
  activity: Activity,
  "arrow-right": ArrowRight,
  "book-open": BookOpen,
  bookmark: Bookmark,
  "chart-column": ChartColumn,
  "chevron-down": ChevronDown,
  "chevron-up": ChevronUp,
  "circle-check": CircleCheck,
  "circle-dashed": CircleDashed,
  "file-text": FileText,
  gauge: Gauge,
  "heart-pulse": HeartPulse,
  "key-round": KeyRound,
  "layout-dashboard": LayoutDashboard,
  "log-out": LogOut,
  menu: Menu,
  "message-square": MessageSquare,
  plug: Plug,
  plus: Plus,
  radar: Radar,
  search: Search,
  server: Server,
  settings: Settings,
  shield: Shield,
  "shield-check": ShieldCheck,
  "user-round": UserRound,
  x: X,
};

export function Icon({ name, size = 18 }) {
  const Glyph = ICONS[name];
  if (!Glyph) return null;
  return (
    <Glyph
      size={size}
      strokeWidth={1.9}
      aria-hidden="true"
      style={{ flex: "0 0 auto" }}
    />
  );
}
