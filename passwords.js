/* Aloud — initial password hashes (PBKDF2-SHA256, 150k iters) for the colleague profiles.
 * Only salted hashes are stored here; plaintext was delivered out-of-band. A colleague's CHANGED
 * password is kept in localStorage (proofreader:pw:<email>) and overrides this initial one. window.PRPasswords. */
window.PRPasswords = {
 "csikos.fanni@sze.hu": {
  "salt": "VgXuHh73SNfZDioszVPWVA==",
  "iters": 150000,
  "hash": "ZK7WOPZuxa06Ht0JfJcNplQqLnvkK6N1TA6NlGfeHYc="
 },
 "pekk.leticia@ga.sze.hu": {
  "salt": "D3XPO4Yrt41bi0Po7GK4GA==",
  "iters": 150000,
  "hash": "xNlv9TeaTazySBUkScMIzD+jRQaqRB9oVXKAwSrpmYU="
 },
 "ihasz.mate@sze.hu": {
  "salt": "wNZITyd9zQxNXBueURkNUw==",
  "iters": 150000,
  "hash": "pya5dkMemgnkfTjIJhPhk4Z34nR2iVugeYf9nEMDJfM="
 },
 "jagicza.marton@ga.sze.hu": {
  "salt": "J0kkN6uV/yIKzIufEmyiWA==",
  "iters": 150000,
  "hash": "C5C4pLws9Kh5jIWc/nEuwKrpJlai2k95iEjZzjskSvs="
 },
 "cseke.tibor@sze.hu": {
  "salt": "9OQ1qWSFe83LigLP3D4gYA==",
  "iters": 150000,
  "hash": "1ufbyVlwL83SPcjSteDBHF0suUABkiKdirKB+YEJA+Y="
 },
 "sutheo.gergo@ga.sze.hu": {
  "salt": "OiWA0Joo4AnJ92xpKpljPQ==",
  "iters": 150000,
  "hash": "oUjaApE9tSP47qMsFIJzUA1JP0efc4xuWUqY9jdylKA="
 }
};
