# What a pair shows the user, and what it keeps to itself (T65)

Rule: **a banner, an amber/red dot or a "needs you" count appears only when the user has something to DO.** Internal retry mechanics that heal themselves are written to the server log and to the collapsed "פרטים טכניים" section at the bottom of the board, never to the banner, the dot, the summary or the activity list. If the alert area cried wolf, a real problem later would be ignored too (this is also why the pair dot of T46 must stay honest).

Three classes, every alert key and activity entry of `server/duo/duo.js` is in exactly one of them:

| class | shown where | entries |
|---|---|---|
| **A. Needs the user** | a calm banner on the board (one short Hebrew sentence + one button that does the thing); amber or red dot on the pair tab; counted in the summary and the side list; also in "פעילות אחרונה" | `closed:<role>` (red, "<agent> נסגר", button **הפעלה מחדש של ה<agent>**, T51) · `permission:<role>` ("<agent> ממתין לאישור הרשאה בטרמינל", button **פתיחת הטרמינל של ה<agent>**) · `nostart:<role>` ("<agent> עוד לא התחיל. ייתכן שצריך לאשר 'לסמוך על התיקייה' בטרמינל שלו", button **פתיחת הטרמינל**) · `unresponsive:<role>` (promoted, see below: "<agent> לא מגיב להוראות כבר N דקות", button **פתיחת הטרמינל**) · `stuck` (promoted: "העובד לא מתקדם במשימות…", buttons **פתיחת הטרמינל של העובד** and **כתיבת הערה**) |
| **B. Progress information** | only "פעילות אחרונה" (never a banner) | pair started / restored · paused / resumed · the user wrote in the chat · an agent started working · finished a turn · woke up ("הופעל", "הופעל ידנית") · restarted ("הופעל מחדש") · the A alerts' own "התראה: …" / "נפתר: …" lines |
| **C. Self-healing or diagnostic** | the server log (`server.log`, lines `duo <id> <role> …`) and the collapsed "פרטים טכניים" (remembers if it was opened) | a wake was not received (attempt N, will retry) · a retry wake was sent · the Stop hook sending the worker back to work · a "go on" answer that Claude never acted on (no output, no Stop: the worker is treated as idle and given the goal again) · a wake that was counted as received because the terminal was busy although the submit hook did not arrive · a wake is held back because the user is writing · a held wake is no longer needed · the draft swap was not confirmed / was done |

## Promotion from C to A only on persistence

Constants live at the top of `server/duo/duo.js`.

| problem | becomes an alert when | resolved when |
|---|---|---|
| wake not received (`notreceived`, C) | the same agent missed **3 wakes in a row**, or **5 minutes** passed since its first miss without one answer (`NOTRECEIVED_PROMOTE_COUNT`, `NOTRECEIVED_PROMOTE_MS`). ONE alert `unresponsive:<role>` with the real number of minutes | the agent answers (any hook event of it) |
| worker stops without progress (`stuck`, C) | the Stop hook sends the worker back to work while tasks are open; after **3 returns in a row** with no change at all in the queue (`STOP_BLOCKS_NO_PROGRESS`) it is let go, ONE alert `stuck` is raised, and it is woken again after a growing wait | the queue changes (a task is marked, gets a Result, is added) |

Other rules that go with it:
- The old code said "ינסו שוב בעוד דקה" but never retried (the counters that decide a wake were updated before the wake was typed). Now a missed wake **is** retried: first after 8 seconds (almost always a start-up glitch), then every minute (`FIRST_RETRY_MS`), until it is received or the pair is paused or closed.
- The two simultaneous "not received" lines right after a server start (both agents woken before Claude's input box was ready) are prevented at the source: the first wake after an agent's `SessionStart` waits 2.5 seconds (`BOOT_SETTLE_MS`), and a first miss is retried after 8 seconds. Anything that still slips through is class C.
- "הודעה ממתינה" (T62: a wake held back because the user is writing to that agent) appears only after the wake has been held for 10 seconds (`PENDING_SHOW_MS`). A retry waiting for its turn is never shown that way.
- The banner has no "+N / פחות" toggle and no truncated text; every alert is a sentence and a button, X hides that one alert until it resolves and comes back.

Tests: `tests/unit/duo-noise.js` (thresholds, promotion, resolution, buttons), `tests/unit/duo-alerts.js`, `tests/server/duo-noise.js` (a deaf fake agent: silent retries, one alert on the third miss, recovery), `tests/e2e/duo-alerts-ui.js` (banner, button, dot, collapsed details, restart from the banner). Screenshots: `docs/screens/T65-alerts-before.png` (old: amber banner "ההוראה להעובד לא התקבלה. ינסו שוב בעוד דקה" with "+1") and `T65-alerts-after.png`.
