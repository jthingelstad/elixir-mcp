# The JSON API says when a retry will help

Every unexpected fault in the JSON API used to answer 503 with Retry-After, asking a program to retry a bug that would fail again the same way. Now only a database that is briefly unreachable, or a query that ran out of time, answers 503 with Retry-After; anything else is 500 internal, with no retry invited. The clan fact operations now declare the integration key they already accepted, and a person's call refused for a missing capability shows in the usage log. JSON API 2.6.4; no change to the tools.
