import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Award,
  Bell,
  BookOpen,
  Bookmark,
  Castle,
  CalendarDays,
  ChartColumn,
  ChartLine,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
  CircleCheck,
  CircleDashed,
  Clock,
  Code,
  Copy,
  Crown,
  Droplet,
  ExternalLink,
  FileText,
  Gamepad2,
  Fingerprint,
  Gauge,
  HeartPulse,
  History,
  Inbox,
  Info,
  KeyRound,
  Mail,
  MapIcon,
  MapPin,
  MonitorSmartphone,
  Layers,
  Link2,
  LayoutDashboard,
  List,
  LayoutGrid,
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
  ShieldQuestionMark,
  ShieldX,
  Star,
  Timer,
  UserRound,
  Users,
  X,
  Wrench,
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
  "arrow-up-right": ArrowUpRight,
  award: Award,
  bell: Bell,
  "book-open": BookOpen,
  bookmark: Bookmark,
  castle: Castle,
  "calendar-days": CalendarDays,
  "chart-column": ChartColumn,
  "chart-line": ChartLine,
  check: Check,
  "chevron-down": ChevronDown,
  "chevron-right": ChevronRight,
  "chevron-up": ChevronUp,
  "chevrons-up-down": ChevronsUpDown,
  "circle-check": CircleCheck,
  "circle-dashed": CircleDashed,
  clock: Clock,
  code: Code,
  copy: Copy,
  crown: Crown,
  droplet: Droplet,
  "external-link": ExternalLink,
  "file-text": FileText,
  "gamepad-2": Gamepad2,
  fingerprint: Fingerprint,
  gauge: Gauge,
  "heart-pulse": HeartPulse,
  history: History,
  inbox: Inbox,
  info: Info,
  "key-round": KeyRound,
  layers: Layers,
  "link-2": Link2,
  "layout-dashboard": LayoutDashboard,
  list: List,
  "layout-grid": LayoutGrid,
  "log-out": LogOut,
  mail: Mail,
  map: MapIcon,
  "map-pin": MapPin,
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
  "shield-question-mark": ShieldQuestionMark,
  "shield-x": ShieldX,
  star: Star,
  timer: Timer,
  "user-round": UserRound,
  users: Users,
  wrench: Wrench,
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
