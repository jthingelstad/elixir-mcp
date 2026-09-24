import {
  Activity,
  ArrowRight,
  Award,
  Bell,
  BookOpen,
  Bookmark,
  ChartColumn,
  Check,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  CircleDashed,
  Copy,
  Droplet,
  ExternalLink,
  FileText,
  Gauge,
  HeartPulse,
  History,
  Inbox,
  KeyRound,
  Mail,
  MonitorSmartphone,
  Layers,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  MessageSquare,
  Plane,
  Plug,
  Plus,
  Radar,
  Repeat,
  Search,
  Server,
  Settings,
  Shield,
  ShieldCheck,
  UserRound,
  Users,
  X,
} from "lucide-react";

/**
 * The family's icons, from Lucide.
 *
 * The design draws the rail with Lucide and this is Lucide — the
 * package, not forty glyphs copied out of it. The copies were a
 * dependency the apps did not want, paid for in the currency they do
 * not want either: a set that goes stale the moment Lucide fixes a
 * path, and a wall a future screen has to climb to use one more icon.
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
  award: Award,
  bell: Bell,
  "book-open": BookOpen,
  bookmark: Bookmark,
  "chart-column": ChartColumn,
  check: Check,
  "chevron-down": ChevronDown,
  "chevron-up": ChevronUp,
  "circle-check": CircleCheck,
  "circle-dashed": CircleDashed,
  copy: Copy,
  droplet: Droplet,
  "external-link": ExternalLink,
  "file-text": FileText,
  gauge: Gauge,
  "heart-pulse": HeartPulse,
  history: History,
  inbox: Inbox,
  "key-round": KeyRound,
  layers: Layers,
  "layout-dashboard": LayoutDashboard,
  "log-out": LogOut,
  mail: Mail,
  megaphone: Megaphone,
  menu: Menu,
  "monitor-smartphone": MonitorSmartphone,
  "message-square": MessageSquare,
  plane: Plane,
  plug: Plug,
  plus: Plus,
  radar: Radar,
  repeat: Repeat,
  search: Search,
  server: Server,
  settings: Settings,
  shield: Shield,
  "shield-check": ShieldCheck,
  "user-round": UserRound,
  users: Users,
  x: X,
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  size = 18,
}: {
  name: IconName | string;
  size?: number;
}) {
  const Glyph = ICONS[name as IconName];
  if (!Glyph) return null;
  return (
    <Glyph
      size={size}
      strokeWidth={1.9}
      aria-hidden="true"
      className="shrink-0"
    />
  );
}
