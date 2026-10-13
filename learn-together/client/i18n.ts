// Minimal message catalog (Sharp Study has no i18n layer yet). Content carries its own locale.
const en = {
  "app.name": "Learn Together",
  "nav.home": "Home",
  "nav.explore": "Explore",
  "nav.family": "Family",
  "nav.privacy": "Privacy",
  "nav.admin": "Content admin",
  "home.cta": "Start a 10-minute activity",
  "home.resume": "Resume",
  "home.next": "Next for {name}",
  "device.online": "Device online",
  "device.offline": "Device offline",
  "device.not_paired": "No device paired",
  "kid.waiting": "Waiting for your grown-up to start",
  "kid.ready": "I'm ready!",
  "kid.done": "Done!",
  "kid.help": "I need help",
  "kid.helpSent": "Your grown-up is coming",
  "kid.helpSeen": "Your grown-up saw!",
  "kid.answered": "Nice thinking! Tell your grown-up your answer.",
  "kid.whoAnswering": "Who's answering?",
  "kid.close": "You explored {concept}!",
  "kid.journey": "Things you've explored",
  "kid.grownUp": "Grown-up",
  "kid.paused": "Short break. Your grown-up will start again soon.",
  "kid.offline": "Reconnecting…",
  "kid.listen": "Listen",
  "kid.check": "Show",
  "kid.send": "Send",
  "kid.clear": "Clear",
  "join.title": "Join Learn Together",
  "join.enterCode": "Type the code your grown-up shows you",
  "join.waiting": "Ask your grown-up to approve.",
  "join.denied": "Your grown-up said not this time.",
  "join.expired": "That code timed out. Ask for a new one.",
} as const;

export type MessageKey = keyof typeof en;

export function t(key: MessageKey, vars: Record<string, string | number> = {}): string {
  return en[key].replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}
