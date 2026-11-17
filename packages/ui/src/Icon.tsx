import {
  Activity,
  BicepsFlexed,
  Brain,
  Clover,
  Flame,
  Gem,
  Hand,
  Handshake,
  Hourglass,
  Laugh,
  Medal,
  PartyPopper,
  Popcorn,
  Rocket,
  Smile,
  SmilePlus,
  Snowflake,
  Sparkles,
  Sprout,
  Target,
  ThumbsUp,
  Zap,
  ArrowRight,
  ArrowUpRight,
  Award,
  Bell,
  BellRing,
  BookOpen,
  Bookmark,
  Bot,
  Castle,
  CalendarDays,
  ChartColumn,
  ChartLine,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
  CircleCheck,
  CircleHelp,
  CircleDashed,
  Clock,
  Code,
  Copy,
  Crown,
  Droplet,
  ExternalLink,
  Eye,
  FileText,
  Flag,
  Gamepad2,
  Fingerprint,
  GalleryHorizontalEnd,
  Gauge,
  Heart,
  HeartPulse,
  Image as ImageGlyph,
  House,
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
  MessageCircle,
  MessageSquare,
  Plane,
  Plug,
  Plus,
  Radar,
  Repeat,
  Reply,
  Search,
  Server,
  Settings,
  Shield,
  ShieldCheck,
  ShieldQuestionMark,
  ShieldX,
  Stamp,
  Star,
  Swords,
  Timer,
  UserPlus,
  UserRound,
  Users,
  UsersRound,
  X,
  Wrench,
} from "lucide-react";

/**
 * Elixir's icons, from Lucide.
 *
 * The design draws the rail with Lucide and this is Lucide — the
 * package, not forty glyphs copied out of it. The copies were a
 * dependency the apps did not want, paid for in the currency they do
 * not want either: a set that goes stale the moment Lucide fixes a
 * path, and a wall a future screen has to climb to use one more icon.
 *
 * The wrapper stays, and it is doing three jobs worth keeping. It fixes
 * the stroke and size so a rail icon cannot arrive a different weight
 * from the one beside it. It keeps an icon `aria-hidden` when it sits
 * beside words, and names it (`label`) in the one case it stands alone,
 * so an icon-only control is never nameless. And it takes the design's
 * kebab-case names, so
 * `<Icon name="chart-column" />` reads the same as the design file it
 * came from.
 *
 * To add one: import it and add the line. Lucide's own name, in kebab
 * case, is the key. Which glyph means what is `docs/design/glyphs.md`
 * (2026-11-17, "Lucide is the glyph library"): one idea, one glyph.
 */
const ICONS = {
  activity: Activity,
  "biceps-flexed": BicepsFlexed,
  brain: Brain,
  clover: Clover,
  flame: Flame,
  gem: Gem,
  hand: Hand,
  handshake: Handshake,
  hourglass: Hourglass,
  laugh: Laugh,
  medal: Medal,
  "party-popper": PartyPopper,
  popcorn: Popcorn,
  rocket: Rocket,
  smile: Smile,
  "smile-plus": SmilePlus,
  snowflake: Snowflake,
  sparkles: Sparkles,
  sprout: Sprout,
  target: Target,
  "thumbs-up": ThumbsUp,
  zap: Zap,
  "arrow-right": ArrowRight,
  "arrow-up-right": ArrowUpRight,
  award: Award,
  bell: Bell,
  "bell-ring": BellRing,
  "book-open": BookOpen,
  bookmark: Bookmark,
  bot: Bot,
  castle: Castle,
  "calendar-days": CalendarDays,
  "chart-column": ChartColumn,
  "chart-line": ChartLine,
  check: Check,
  "chevron-down": ChevronDown,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  "chevron-up": ChevronUp,
  "chevrons-up-down": ChevronsUpDown,
  "circle-check": CircleCheck,
  "circle-help": CircleHelp,
  "circle-dashed": CircleDashed,
  clock: Clock,
  code: Code,
  copy: Copy,
  crown: Crown,
  droplet: Droplet,
  "external-link": ExternalLink,
  eye: Eye,
  "file-text": FileText,
  flag: Flag,
  "gamepad-2": Gamepad2,
  fingerprint: Fingerprint,
  "gallery-horizontal-end": GalleryHorizontalEnd,
  gauge: Gauge,
  heart: Heart,
  "heart-pulse": HeartPulse,
  image: ImageGlyph,
  house: House,
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
  "message-circle": MessageCircle,
  "message-square": MessageSquare,
  plane: Plane,
  plug: Plug,
  plus: Plus,
  radar: Radar,
  repeat: Repeat,
  reply: Reply,
  search: Search,
  server: Server,
  settings: Settings,
  shield: Shield,
  "shield-check": ShieldCheck,
  "shield-question-mark": ShieldQuestionMark,
  "shield-x": ShieldX,
  stamp: Stamp,
  star: Star,
  swords: Swords,
  timer: Timer,
  "user-plus": UserPlus,
  "user-round": UserRound,
  users: Users,
  "users-round": UsersRound,
  wrench: Wrench,
  x: X,
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  size = 18,
  label,
  className,
}: {
  name: IconName | string;
  size?: number;
  /** Only when the glyph is the whole content (a count beside it, no
   *  word): it is then an image with this name. Inside a button or link
   *  with words, leave it out and the glyph stays hidden from readers. */
  label?: string;
  className?: string;
}) {
  const Glyph = ICONS[name as IconName];
  if (!Glyph) return null;
  const cls = className ? `shrink-0 ${className}` : "shrink-0";
  return label ? (
    <Glyph
      size={size}
      strokeWidth={1.9}
      role="img"
      aria-label={label}
      className={cls}
    />
  ) : (
    <Glyph size={size} strokeWidth={1.9} aria-hidden="true" className={cls} />
  );
}
