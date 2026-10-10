# Sign-in codes stop competing with each other

A code sent for connecting an AI client and a code sent for signing in to the website are now kept separate. Previously the most recent code of either kind was the only one that could be used, so requesting one while the other was open made the other impossible to enter and could exhaust its attempts. When a code is refused, the page now says which reason applies - superseded, already used, expired, too many attempts, or a code from the other flow - and what to do next.
