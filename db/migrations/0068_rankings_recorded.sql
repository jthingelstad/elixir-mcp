-- The leaderboards become part of the record.
--
-- Until now the recorder GLANCED at a ranking: live_fetch could read the top
-- 100 of one on demand, and the projector kept only the players' names. The
-- ranking itself - who was where, at what rating, in which clan, on which
-- hour - was thrown away, which is the one thing the CR API also throws
-- away every minute. Recording it is the product's thesis applied to the
-- competitive ladder (Jamie, 2026-09-11: "the leaderboards are themselves
-- meaningful data").
--
-- Three tables.
--
-- ranking_board is the list of boards we remember and how often: which
-- rankings the scheduler plans, at what cadence, and for which of them a
-- top-N appearance is a reason to RECORD the player (see ranking_presence).
-- Seeded with every location the API lists (262 on 2026-09-11) at daily,
-- and the global board hourly - hourly is the grain of a movement video,
-- and the API's own cache (max-age ~60s) says each hourly read is new.
--
-- ranking_snapshot / ranking_entry is one observed board: a header per
-- fetch and a row per placed player. A fetch whose content matches the
-- previous snapshot writes NOTHING (content_hash): overnight the board
-- barely moves, and an identical hour is not information. `truncated`
-- says the API offered a cursor we did not follow, so a board over the
-- request limit is never mistaken for a complete one.
--
-- ranking_presence is the recording reason. Once a player appears in the
-- top N of a board that records, they are recorded at comprehensive scope
-- until sticky_until - the next season roll plus a grace - whether or not
-- they stay in the top N. A collection that mirrors "the current top 100"
-- would stop recording a player who dipped to #101 for an afternoon; the
-- season's story of its eventual #1 needs every battle, including the ones
-- from the hours after the roll when the whole board is empty - which the
-- grace from LAST season's presence is what carries them through.

create table ranking_board (
  board          text not null check (board in ('pol', 'trophy')),
  location_key   text not null,               -- 'global' or a numeric location id
  label          text not null,
  location_kind  text not null check (location_kind in ('global', 'region', 'country')),
  country_code   text,
  every_minutes  integer not null default 1440 check (every_minutes >= 15),
  -- 0 = a board we remember but do not record players from.
  record_top     integer not null default 0 check (record_top >= 0),
  enabled        boolean not null default true,
  created_at     timestamptz not null default now(),
  primary key (board, location_key)
);

comment on table ranking_board is
  'Which leaderboards the scheduler records, how often, and for which a top-N appearance is a recording reason (record_top).';

insert into ranking_board (board, location_key, label, location_kind, country_code, every_minutes, record_top, enabled) values
  ('pol', 'global', 'Global', 'global', null, 60, 200, true),
  ('pol', '57000000', 'Europe', 'region', null, 1440, 0, true),
  ('pol', '57000001', 'North America', 'region', null, 1440, 0, true),
  ('pol', '57000002', 'South America', 'region', null, 1440, 0, true),
  ('pol', '57000003', 'Asia', 'region', null, 1440, 0, true),
  ('pol', '57000004', 'Oceania', 'region', null, 1440, 0, true),
  ('pol', '57000005', 'Africa', 'region', null, 1440, 0, true),
  ('pol', '57000006', 'International', 'region', null, 1440, 0, true),
  ('pol', '57000007', 'Afghanistan', 'country', 'AF', 1440, 0, true),
  ('pol', '57000008', 'Åland Islands', 'country', 'AX', 1440, 0, true),
  ('pol', '57000009', 'Albania', 'country', 'AL', 1440, 0, true),
  ('pol', '57000010', 'Algeria', 'country', 'DZ', 1440, 0, true),
  ('pol', '57000011', 'American Samoa', 'country', 'AS', 1440, 0, true),
  ('pol', '57000012', 'Andorra', 'country', 'AD', 1440, 0, true),
  ('pol', '57000013', 'Angola', 'country', 'AO', 1440, 0, true),
  ('pol', '57000014', 'Anguilla', 'country', 'AI', 1440, 0, true),
  ('pol', '57000015', 'Antarctica', 'country', 'AQ', 1440, 0, true),
  ('pol', '57000016', 'Antigua and Barbuda', 'country', 'AG', 1440, 0, true),
  ('pol', '57000017', 'Argentina', 'country', 'AR', 1440, 0, true),
  ('pol', '57000018', 'Armenia', 'country', 'AM', 1440, 0, true),
  ('pol', '57000019', 'Aruba', 'country', 'AW', 1440, 0, true),
  ('pol', '57000020', 'Ascension Island', 'country', 'AC', 1440, 0, true),
  ('pol', '57000021', 'Australia', 'country', 'AU', 1440, 0, true),
  ('pol', '57000022', 'Austria', 'country', 'AT', 1440, 0, true),
  ('pol', '57000023', 'Azerbaijan', 'country', 'AZ', 1440, 0, true),
  ('pol', '57000024', 'Bahamas', 'country', 'BS', 1440, 0, true),
  ('pol', '57000025', 'Bahrain', 'country', 'BH', 1440, 0, true),
  ('pol', '57000026', 'Bangladesh', 'country', 'BD', 1440, 0, true),
  ('pol', '57000027', 'Barbados', 'country', 'BB', 1440, 0, true),
  ('pol', '57000028', 'Belarus', 'country', 'BY', 1440, 0, true),
  ('pol', '57000029', 'Belgium', 'country', 'BE', 1440, 0, true),
  ('pol', '57000030', 'Belize', 'country', 'BZ', 1440, 0, true),
  ('pol', '57000031', 'Benin', 'country', 'BJ', 1440, 0, true),
  ('pol', '57000032', 'Bermuda', 'country', 'BM', 1440, 0, true),
  ('pol', '57000033', 'Bhutan', 'country', 'BT', 1440, 0, true),
  ('pol', '57000034', 'Bolivia', 'country', 'BO', 1440, 0, true),
  ('pol', '57000035', 'Bosnia and Herzegovina', 'country', 'BA', 1440, 0, true),
  ('pol', '57000036', 'Botswana', 'country', 'BW', 1440, 0, true),
  ('pol', '57000037', 'Bouvet Island', 'country', 'BV', 1440, 0, true),
  ('pol', '57000038', 'Brazil', 'country', 'BR', 1440, 0, true),
  ('pol', '57000039', 'British Indian Ocean Territory', 'country', 'IO', 1440, 0, true),
  ('pol', '57000040', 'British Virgin Islands', 'country', 'VG', 1440, 0, true),
  ('pol', '57000041', 'Brunei', 'country', 'BN', 1440, 0, true),
  ('pol', '57000042', 'Bulgaria', 'country', 'BG', 1440, 0, true),
  ('pol', '57000043', 'Burkina Faso', 'country', 'BF', 1440, 0, true),
  ('pol', '57000044', 'Burundi', 'country', 'BI', 1440, 0, true),
  ('pol', '57000045', 'Cambodia', 'country', 'KH', 1440, 0, true),
  ('pol', '57000046', 'Cameroon', 'country', 'CM', 1440, 0, true),
  ('pol', '57000047', 'Canada', 'country', 'CA', 1440, 0, true),
  ('pol', '57000048', 'Canary Islands', 'country', 'IC', 1440, 0, true),
  ('pol', '57000049', 'Cape Verde', 'country', 'CV', 1440, 0, true),
  ('pol', '57000050', 'Caribbean Netherlands', 'country', 'BQ', 1440, 0, true),
  ('pol', '57000051', 'Cayman Islands', 'country', 'KY', 1440, 0, true),
  ('pol', '57000052', 'Central African Republic', 'country', 'CF', 1440, 0, true),
  ('pol', '57000053', 'Ceuta and Melilla', 'country', 'EA', 1440, 0, true),
  ('pol', '57000054', 'Chad', 'country', 'TD', 1440, 0, true),
  ('pol', '57000055', 'Chile', 'country', 'CL', 1440, 0, true),
  ('pol', '57000056', 'China', 'country', 'CN', 1440, 0, true),
  ('pol', '57000057', 'Christmas Island', 'country', 'CX', 1440, 0, true),
  ('pol', '57000058', 'Cocos (Keeling) Islands', 'country', 'CC', 1440, 0, true),
  ('pol', '57000059', 'Colombia', 'country', 'CO', 1440, 0, true),
  ('pol', '57000060', 'Comoros', 'country', 'KM', 1440, 0, true),
  ('pol', '57000061', 'Congo (DRC)', 'country', 'CG', 1440, 0, true),
  ('pol', '57000062', 'Congo (Republic)', 'country', 'CD', 1440, 0, true),
  ('pol', '57000063', 'Cook Islands', 'country', 'CK', 1440, 0, true),
  ('pol', '57000064', 'Costa Rica', 'country', 'CR', 1440, 0, true),
  ('pol', '57000065', 'Côte d’Ivoire', 'country', 'CI', 1440, 0, true),
  ('pol', '57000066', 'Croatia', 'country', 'HR', 1440, 0, true),
  ('pol', '57000067', 'Cuba', 'country', 'CU', 1440, 0, true),
  ('pol', '57000068', 'Curaçao', 'country', 'CW', 1440, 0, true),
  ('pol', '57000069', 'Cyprus', 'country', 'CY', 1440, 0, true),
  ('pol', '57000070', 'Czech Republic', 'country', 'CZ', 1440, 0, true),
  ('pol', '57000071', 'Denmark', 'country', 'DK', 1440, 0, true),
  ('pol', '57000072', 'Diego Garcia', 'country', 'DG', 1440, 0, true),
  ('pol', '57000073', 'Djibouti', 'country', 'DJ', 1440, 0, true),
  ('pol', '57000074', 'Dominica', 'country', 'DM', 1440, 0, true),
  ('pol', '57000075', 'Dominican Republic', 'country', 'DO', 1440, 0, true),
  ('pol', '57000076', 'Ecuador', 'country', 'EC', 1440, 0, true),
  ('pol', '57000077', 'Egypt', 'country', 'EG', 1440, 0, true),
  ('pol', '57000078', 'El Salvador', 'country', 'SV', 1440, 0, true),
  ('pol', '57000079', 'Equatorial Guinea', 'country', 'GQ', 1440, 0, true),
  ('pol', '57000080', 'Eritrea', 'country', 'ER', 1440, 0, true),
  ('pol', '57000081', 'Estonia', 'country', 'EE', 1440, 0, true),
  ('pol', '57000082', 'Ethiopia', 'country', 'ET', 1440, 0, true),
  ('pol', '57000083', 'Falkland Islands', 'country', 'FK', 1440, 0, true),
  ('pol', '57000084', 'Faroe Islands', 'country', 'FO', 1440, 0, true),
  ('pol', '57000085', 'Fiji', 'country', 'FJ', 1440, 0, true),
  ('pol', '57000086', 'Finland', 'country', 'FI', 1440, 0, true),
  ('pol', '57000087', 'France', 'country', 'FR', 1440, 0, true),
  ('pol', '57000088', 'French Guiana', 'country', 'GF', 1440, 0, true),
  ('pol', '57000089', 'French Polynesia', 'country', 'PF', 1440, 0, true),
  ('pol', '57000090', 'French Southern Territories', 'country', 'TF', 1440, 0, true),
  ('pol', '57000091', 'Gabon', 'country', 'GA', 1440, 0, true),
  ('pol', '57000092', 'Gambia', 'country', 'GM', 1440, 0, true),
  ('pol', '57000093', 'Georgia', 'country', 'GE', 1440, 0, true),
  ('pol', '57000094', 'Germany', 'country', 'DE', 1440, 0, true),
  ('pol', '57000095', 'Ghana', 'country', 'GH', 1440, 0, true),
  ('pol', '57000096', 'Gibraltar', 'country', 'GI', 1440, 0, true),
  ('pol', '57000097', 'Greece', 'country', 'GR', 1440, 0, true),
  ('pol', '57000098', 'Greenland', 'country', 'GL', 1440, 0, true),
  ('pol', '57000099', 'Grenada', 'country', 'GD', 1440, 0, true),
  ('pol', '57000100', 'Guadeloupe', 'country', 'GP', 1440, 0, true),
  ('pol', '57000101', 'Guam', 'country', 'GU', 1440, 0, true),
  ('pol', '57000102', 'Guatemala', 'country', 'GT', 1440, 0, true),
  ('pol', '57000103', 'Guernsey', 'country', 'GG', 1440, 0, true),
  ('pol', '57000104', 'Guinea', 'country', 'GN', 1440, 0, true),
  ('pol', '57000105', 'Guinea-Bissau', 'country', 'GW', 1440, 0, true),
  ('pol', '57000106', 'Guyana', 'country', 'GY', 1440, 0, true),
  ('pol', '57000107', 'Haiti', 'country', 'HT', 1440, 0, true),
  ('pol', '57000108', 'Heard & McDonald Islands', 'country', 'HM', 1440, 0, true),
  ('pol', '57000109', 'Honduras', 'country', 'HN', 1440, 0, true),
  ('pol', '57000110', 'Hong Kong', 'country', 'HK', 1440, 0, true),
  ('pol', '57000111', 'Hungary', 'country', 'HU', 1440, 0, true),
  ('pol', '57000112', 'Iceland', 'country', 'IS', 1440, 0, true),
  ('pol', '57000113', 'India', 'country', 'IN', 1440, 0, true),
  ('pol', '57000114', 'Indonesia', 'country', 'ID', 1440, 0, true),
  ('pol', '57000115', 'Iran', 'country', 'IR', 1440, 0, true),
  ('pol', '57000116', 'Iraq', 'country', 'IQ', 1440, 0, true),
  ('pol', '57000117', 'Ireland', 'country', 'IE', 1440, 0, true),
  ('pol', '57000118', 'Isle of Man', 'country', 'IM', 1440, 0, true),
  ('pol', '57000119', 'Israel', 'country', 'IL', 1440, 0, true),
  ('pol', '57000120', 'Italy', 'country', 'IT', 1440, 0, true),
  ('pol', '57000121', 'Jamaica', 'country', 'JM', 1440, 0, true),
  ('pol', '57000122', 'Japan', 'country', 'JP', 1440, 0, true),
  ('pol', '57000123', 'Jersey', 'country', 'JE', 1440, 0, true),
  ('pol', '57000124', 'Jordan', 'country', 'JO', 1440, 0, true),
  ('pol', '57000125', 'Kazakhstan', 'country', 'KZ', 1440, 0, true),
  ('pol', '57000126', 'Kenya', 'country', 'KE', 1440, 0, true),
  ('pol', '57000127', 'Kiribati', 'country', 'KI', 1440, 0, true),
  ('pol', '57000128', 'Kosovo', 'country', 'XK', 1440, 0, true),
  ('pol', '57000129', 'Kuwait', 'country', 'KW', 1440, 0, true),
  ('pol', '57000130', 'Kyrgyzstan', 'country', 'KG', 1440, 0, true),
  ('pol', '57000131', 'Laos', 'country', 'LA', 1440, 0, true),
  ('pol', '57000132', 'Latvia', 'country', 'LV', 1440, 0, true),
  ('pol', '57000133', 'Lebanon', 'country', 'LB', 1440, 0, true),
  ('pol', '57000134', 'Lesotho', 'country', 'LS', 1440, 0, true),
  ('pol', '57000135', 'Liberia', 'country', 'LR', 1440, 0, true),
  ('pol', '57000136', 'Libya', 'country', 'LY', 1440, 0, true),
  ('pol', '57000137', 'Liechtenstein', 'country', 'LI', 1440, 0, true),
  ('pol', '57000138', 'Lithuania', 'country', 'LT', 1440, 0, true),
  ('pol', '57000139', 'Luxembourg', 'country', 'LU', 1440, 0, true),
  ('pol', '57000140', 'Macau', 'country', 'MO', 1440, 0, true),
  ('pol', '57000141', 'Macedonia (FYROM)', 'country', 'MK', 1440, 0, true),
  ('pol', '57000142', 'Madagascar', 'country', 'MG', 1440, 0, true),
  ('pol', '57000143', 'Malawi', 'country', 'MW', 1440, 0, true),
  ('pol', '57000144', 'Malaysia', 'country', 'MY', 1440, 0, true),
  ('pol', '57000145', 'Maldives', 'country', 'MV', 1440, 0, true),
  ('pol', '57000146', 'Mali', 'country', 'ML', 1440, 0, true),
  ('pol', '57000147', 'Malta', 'country', 'MT', 1440, 0, true),
  ('pol', '57000148', 'Marshall Islands', 'country', 'MH', 1440, 0, true),
  ('pol', '57000149', 'Martinique', 'country', 'MQ', 1440, 0, true),
  ('pol', '57000150', 'Mauritania', 'country', 'MR', 1440, 0, true),
  ('pol', '57000151', 'Mauritius', 'country', 'MU', 1440, 0, true),
  ('pol', '57000152', 'Mayotte', 'country', 'YT', 1440, 0, true),
  ('pol', '57000153', 'Mexico', 'country', 'MX', 1440, 0, true),
  ('pol', '57000154', 'Micronesia', 'country', 'FM', 1440, 0, true),
  ('pol', '57000155', 'Moldova', 'country', 'MD', 1440, 0, true),
  ('pol', '57000156', 'Monaco', 'country', 'MC', 1440, 0, true),
  ('pol', '57000157', 'Mongolia', 'country', 'MN', 1440, 0, true),
  ('pol', '57000158', 'Montenegro', 'country', 'ME', 1440, 0, true),
  ('pol', '57000159', 'Montserrat', 'country', 'MS', 1440, 0, true),
  ('pol', '57000160', 'Morocco', 'country', 'MA', 1440, 0, true),
  ('pol', '57000161', 'Mozambique', 'country', 'MZ', 1440, 0, true),
  ('pol', '57000162', 'Myanmar (Burma)', 'country', 'MM', 1440, 0, true),
  ('pol', '57000163', 'Namibia', 'country', 'NA', 1440, 0, true),
  ('pol', '57000164', 'Nauru', 'country', 'NR', 1440, 0, true),
  ('pol', '57000165', 'Nepal', 'country', 'NP', 1440, 0, true),
  ('pol', '57000166', 'Netherlands', 'country', 'NL', 1440, 0, true),
  ('pol', '57000167', 'New Caledonia', 'country', 'NC', 1440, 0, true),
  ('pol', '57000168', 'New Zealand', 'country', 'NZ', 1440, 0, true),
  ('pol', '57000169', 'Nicaragua', 'country', 'NI', 1440, 0, true),
  ('pol', '57000170', 'Niger', 'country', 'NE', 1440, 0, true),
  ('pol', '57000171', 'Nigeria', 'country', 'NG', 1440, 0, true),
  ('pol', '57000172', 'Niue', 'country', 'NU', 1440, 0, true),
  ('pol', '57000173', 'Norfolk Island', 'country', 'NF', 1440, 0, true),
  ('pol', '57000174', 'North Korea', 'country', 'KP', 1440, 0, true),
  ('pol', '57000175', 'Northern Mariana Islands', 'country', 'MP', 1440, 0, true),
  ('pol', '57000176', 'Norway', 'country', 'NO', 1440, 0, true),
  ('pol', '57000177', 'Oman', 'country', 'OM', 1440, 0, true),
  ('pol', '57000178', 'Pakistan', 'country', 'PK', 1440, 0, true),
  ('pol', '57000179', 'Palau', 'country', 'PW', 1440, 0, true),
  ('pol', '57000180', 'Palestine', 'country', 'PS', 1440, 0, true),
  ('pol', '57000181', 'Panama', 'country', 'PA', 1440, 0, true),
  ('pol', '57000182', 'Papua New Guinea', 'country', 'PG', 1440, 0, true),
  ('pol', '57000183', 'Paraguay', 'country', 'PY', 1440, 0, true),
  ('pol', '57000184', 'Peru', 'country', 'PE', 1440, 0, true),
  ('pol', '57000185', 'Philippines', 'country', 'PH', 1440, 0, true),
  ('pol', '57000186', 'Pitcairn Islands', 'country', 'PN', 1440, 0, true),
  ('pol', '57000187', 'Poland', 'country', 'PL', 1440, 0, true),
  ('pol', '57000188', 'Portugal', 'country', 'PT', 1440, 0, true),
  ('pol', '57000189', 'Puerto Rico', 'country', 'PR', 1440, 0, true),
  ('pol', '57000190', 'Qatar', 'country', 'QA', 1440, 0, true),
  ('pol', '57000191', 'Réunion', 'country', 'RE', 1440, 0, true),
  ('pol', '57000192', 'Romania', 'country', 'RO', 1440, 0, true),
  ('pol', '57000193', 'Russia', 'country', 'RU', 1440, 0, true),
  ('pol', '57000194', 'Rwanda', 'country', 'RW', 1440, 0, true),
  ('pol', '57000195', 'Saint Barthélemy', 'country', 'BL', 1440, 0, true),
  ('pol', '57000196', 'Saint Helena', 'country', 'SH', 1440, 0, true),
  ('pol', '57000197', 'Saint Kitts and Nevis', 'country', 'KN', 1440, 0, true),
  ('pol', '57000198', 'Saint Lucia', 'country', 'LC', 1440, 0, true),
  ('pol', '57000199', 'Saint Martin', 'country', 'MF', 1440, 0, true),
  ('pol', '57000200', 'Saint Pierre and Miquelon', 'country', 'PM', 1440, 0, true),
  ('pol', '57000201', 'Samoa', 'country', 'WS', 1440, 0, true),
  ('pol', '57000202', 'San Marino', 'country', 'SM', 1440, 0, true),
  ('pol', '57000203', 'São Tomé and Príncipe', 'country', 'ST', 1440, 0, true),
  ('pol', '57000204', 'Saudi Arabia', 'country', 'SA', 1440, 0, true),
  ('pol', '57000205', 'Senegal', 'country', 'SN', 1440, 0, true),
  ('pol', '57000206', 'Serbia', 'country', 'RS', 1440, 0, true),
  ('pol', '57000207', 'Seychelles', 'country', 'SC', 1440, 0, true),
  ('pol', '57000208', 'Sierra Leone', 'country', 'SL', 1440, 0, true),
  ('pol', '57000209', 'Singapore', 'country', 'SG', 1440, 0, true),
  ('pol', '57000210', 'Sint Maarten', 'country', 'SX', 1440, 0, true),
  ('pol', '57000211', 'Slovakia', 'country', 'SK', 1440, 0, true),
  ('pol', '57000212', 'Slovenia', 'country', 'SI', 1440, 0, true),
  ('pol', '57000213', 'Solomon Islands', 'country', 'SB', 1440, 0, true),
  ('pol', '57000214', 'Somalia', 'country', 'SO', 1440, 0, true),
  ('pol', '57000215', 'South Africa', 'country', 'ZA', 1440, 0, true),
  ('pol', '57000216', 'South Korea', 'country', 'KR', 1440, 0, true),
  ('pol', '57000217', 'South Sudan', 'country', 'SS', 1440, 0, true),
  ('pol', '57000218', 'Spain', 'country', 'ES', 1440, 0, true),
  ('pol', '57000219', 'Sri Lanka', 'country', 'LK', 1440, 0, true),
  ('pol', '57000220', 'St. Vincent & Grenadines', 'country', 'VC', 1440, 0, true),
  ('pol', '57000221', 'Sudan', 'country', 'SD', 1440, 0, true),
  ('pol', '57000222', 'Suriname', 'country', 'SR', 1440, 0, true),
  ('pol', '57000223', 'Svalbard and Jan Mayen', 'country', 'SJ', 1440, 0, true),
  ('pol', '57000224', 'Swaziland', 'country', 'SZ', 1440, 0, true),
  ('pol', '57000225', 'Sweden', 'country', 'SE', 1440, 0, true),
  ('pol', '57000226', 'Switzerland', 'country', 'CH', 1440, 0, true),
  ('pol', '57000227', 'Syria', 'country', 'SY', 1440, 0, true),
  ('pol', '57000228', 'Taiwan', 'country', 'TW', 1440, 0, true),
  ('pol', '57000229', 'Tajikistan', 'country', 'TJ', 1440, 0, true),
  ('pol', '57000230', 'Tanzania', 'country', 'TZ', 1440, 0, true),
  ('pol', '57000231', 'Thailand', 'country', 'TH', 1440, 0, true),
  ('pol', '57000232', 'Timor-Leste', 'country', 'TL', 1440, 0, true),
  ('pol', '57000233', 'Togo', 'country', 'TG', 1440, 0, true),
  ('pol', '57000234', 'Tokelau', 'country', 'TK', 1440, 0, true),
  ('pol', '57000235', 'Tonga', 'country', 'TO', 1440, 0, true),
  ('pol', '57000236', 'Trinidad and Tobago', 'country', 'TT', 1440, 0, true),
  ('pol', '57000237', 'Tristan da Cunha', 'country', 'TA', 1440, 0, true),
  ('pol', '57000238', 'Tunisia', 'country', 'TN', 1440, 0, true),
  ('pol', '57000239', 'Turkey', 'country', 'TR', 1440, 0, true),
  ('pol', '57000240', 'Turkmenistan', 'country', 'TM', 1440, 0, true),
  ('pol', '57000241', 'Turks and Caicos Islands', 'country', 'TC', 1440, 0, true),
  ('pol', '57000242', 'Tuvalu', 'country', 'TV', 1440, 0, true),
  ('pol', '57000243', 'U.S. Outlying Islands', 'country', 'UM', 1440, 0, true),
  ('pol', '57000244', 'U.S. Virgin Islands', 'country', 'VI', 1440, 0, true),
  ('pol', '57000245', 'Uganda', 'country', 'UG', 1440, 0, true),
  ('pol', '57000246', 'Ukraine', 'country', 'UA', 1440, 0, true),
  ('pol', '57000247', 'United Arab Emirates', 'country', 'AE', 1440, 0, true),
  ('pol', '57000248', 'United Kingdom', 'country', 'GB', 1440, 0, true),
  ('pol', '57000249', 'United States', 'country', 'US', 1440, 0, true),
  ('pol', '57000250', 'Uruguay', 'country', 'UY', 1440, 0, true),
  ('pol', '57000251', 'Uzbekistan', 'country', 'UZ', 1440, 0, true),
  ('pol', '57000252', 'Vanuatu', 'country', 'VU', 1440, 0, true),
  ('pol', '57000253', 'Vatican City', 'country', 'VA', 1440, 0, true),
  ('pol', '57000254', 'Venezuela', 'country', 'VE', 1440, 0, true),
  ('pol', '57000255', 'Vietnam', 'country', 'VN', 1440, 0, true),
  ('pol', '57000256', 'Wallis and Futuna', 'country', 'WF', 1440, 0, true),
  ('pol', '57000257', 'Western Sahara', 'country', 'EH', 1440, 0, true),
  ('pol', '57000258', 'Yemen', 'country', 'YE', 1440, 0, true),
  ('pol', '57000259', 'Zambia', 'country', 'ZM', 1440, 0, true),
  ('pol', '57000260', 'Zimbabwe', 'country', 'ZW', 1440, 0, true),
  ('pol', '57000261', 'Unknown', 'region', null, 1440, 0, true);

-- The two boards Jamie has collections for are daily like the rest; the
-- global board is the one that records players.

create table ranking_snapshot (
  snapshot_id    bigint generated always as identity primary key,
  board          text not null,
  location_key   text not null,
  season_id      text,
  observed_at    timestamptz not null,
  -- An identical later fetch bumps this instead of writing a twin: "the
  -- board was still this at 04:00" without a second copy of it.
  last_confirmed_at timestamptz not null,
  content_hash   text not null,
  entries        integer not null,
  truncated      boolean not null default false,
  receipt_id     bigint,
  foreign key (board, location_key) references ranking_board
);
create index ranking_snapshot_latest
  on ranking_snapshot (board, location_key, observed_at desc);

create table ranking_entry (
  snapshot_id    bigint not null references ranking_snapshot on delete cascade,
  rank           integer not null,
  player_tag     text not null,
  name           text,
  rating         integer,
  clan_tag       text,
  clan_name      text,
  primary key (snapshot_id, rank)
);
-- "Where was this player, when" and "which clan, when": the two axes a
-- season story is drawn along.
create index ranking_entry_player on ranking_entry (player_tag, snapshot_id);
create index ranking_entry_clan on ranking_entry (clan_tag, snapshot_id) where clan_tag is not null;

comment on table ranking_snapshot is
  'One observed leaderboard. A fetch identical to the previous snapshot writes no row (content_hash); truncated means the API had more than we asked for.';

create table ranking_presence (
  player_tag     text not null references player,
  board          text not null,
  location_key   text not null,
  season_id      text not null,
  first_seen_at  timestamptz not null,
  last_seen_at   timestamptz not null,
  first_rank     integer not null,
  best_rank      integer not null,
  -- Recording holds until here: the next roll plus a grace, so the
  -- opening hours of the next season - when the board is empty and
  -- nobody is otherwise recorded - are captured for last season's field.
  sticky_until   timestamptz not null,
  primary key (player_tag, board, location_key, season_id),
  foreign key (board, location_key) references ranking_board
);
create index ranking_presence_sticky on ranking_presence (sticky_until);

comment on table ranking_presence is
  'A player appeared in the recording top-N of a board this season. A live row (sticky_until > now()) is a reason to record them at comprehensive scope.';

-- A recording can now exist because of a ranking.
alter table recording drop constraint if exists recording_origin_check;
alter table recording
  add constraint recording_origin_check
  check (origin in ('claim', 'ops', 'collection', 'ranking'));
