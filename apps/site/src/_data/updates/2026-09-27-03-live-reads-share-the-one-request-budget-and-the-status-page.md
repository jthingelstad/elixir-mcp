# Live reads share the one request budget, and the status page says how much is spent

Every live read, whether your agent asks for one or an app refreshes a profile, is now counted against the same shared request budget the scheduled recording spends. When that budget is spent for the moment, a live read is not queued and costs you nothing; it answers with the record and says when to try again, within five minutes. The status page and Recording now lead with the last 24 hours against the day's budget. Contract 9.12.3; JSON API 2.6.3.
