// The single rule for "may this account use the API right now?". Tokens are stateless JWTs, so a token
// issued before an administrator deactivated the account is still cryptographically valid; the database
// row is what decides, and every check (sign-in, getAccountActor, profile, family, applications, admin UI)
// uses this one function so they cannot drift apart.
//
// users.status is `tinyint(1) NULL DEFAULT 1`. Sequelize returns it as true/false (or null); raw drivers
// return 1/0. Only an explicit "on" value is active; everything else fails closed:
//   true, 1                       -> active
//   false, 0                      -> inactive (disabled by an admin)
//   null                          -> inactive (never set; sign-in has always refused these accounts)
//   undefined / anything else     -> inactive (the column was not loaded, or the value is not a boolean)
// A NULL account is recoverable from Admin > Students / Instructors > Reactivate, which writes `true`.
export const accountIsActive = (user) => Boolean(user) && (user.status === true || user.status === 1);
