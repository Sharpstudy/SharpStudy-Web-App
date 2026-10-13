# Learn Together manual QA (parent phone + child iPad)

Setup: Vercel **preview** deployment with `FEATURE_LEARN_TOGETHER=true` (default on in preview), a dev/preview database migrated and seeded, and at least one published activity. Optionally set `ABLY_API_KEY` to test push. Repeat the core flow once with Ably and once without.

## Parent (phone)
- [ ] Sign in with an existing Sharp Study account → `/learn` sends you to onboarding.
- [ ] Onboarding: privacy explainer is readable; add 2 children (one with read-aloud on); set a 4-digit PIN.
- [ ] Home shows each child with "No device paired" and a recommendation with a reason.
- [ ] Explore: each filter narrows the list; Save/Hide work; "Show hidden" brings hidden back.
- [ ] Preview: materials show substitutions; science shows the Safety card; "Tell me about this kit" says it's optional.

## Pairing (iPad)
- [ ] iPad: open `/learn/join`, type the code shown on the phone → "Ask your grown-up to approve."
- [ ] Phone shows "A new device wants to join as …". Approve with a label → iPad opens the lobby in a few seconds.
- [ ] Scan the QR code with a second device → same flow; deny it → device shows "not this time".
- [ ] Wait 10 minutes with a code unused → it no longer works.
- [ ] iPad: Add to Home Screen → launches straight into the lobby.

## Connected lesson
- [ ] Phone: Start → "Send to Maya's device" → iPad auto-opens the lesson (note seconds).
- [ ] iPad: I'm ready → phone shows Ready ✓ → Start.
- [ ] Each Next/Back/Repeat/Pause shows on the iPad within about a second. The timer never auto-advances.
- [ ] Read-aloud speaks each step (child with read-aloud on). 🔊 Listen repeats it.
- [ ] Answer a number question → phone shows the answer. Tap "I need help" → phone shows the alert → Acknowledge → iPad button resets.
- [ ] Check step: both questions on the iPad; record clear/partial/not yet on the phone with the guidance visible.
- [ ] Reflect: outcome, private note, confidence. Finish → iPad shows "You explored …!" then returns to the lobby with the new concept highlighted.
- [ ] Progress page: this week, rhythm chart, concept map with "How this is determined", answers ("tried 7, then 9"), things you noticed, export CSV/JSON open correctly.
- [ ] Nothing on the iPad shows "Why this works", "Watch for", expected answers or grown-up wording.

## Resilience / weak network
- [ ] iPad: turn on airplane mode mid-lesson, advance 2 steps on the phone, turn it off → iPad jumps to the right step.
- [ ] Throttle to "Slow 3G" (Safari dev tools or router) → steps still arrive; note delay.
- [ ] Refresh both devices mid-lesson → both resume at the same step.
- [ ] Phone shows "device offline" after ~45 s without the iPad → "Use this device for Maya" moves the child to the phone.

## Single device and siblings
- [ ] Launch with "Use this device" and no paired device → child view appears beside the script on a tablet (≥768 px) and below on a phone.
- [ ] "Hand device to child" → full-screen child mode; leaving needs the family PIN.
- [ ] Launch for two children on one device → child view asks "Who's answering?".
- [ ] Shared device paired to both children with a picture code → avatar tap then 3 pictures.

## Locking, revocation, privacy
- [ ] iPad: 🔒 Grown-up → wrong PIN rejected; 5 wrong tries lock for 15 min.
- [ ] Family → Revoke the iPad → lobby drops to the join screen within a few seconds.
- [ ] Delete a child (asks for your password) → their devices unpair, their progress is gone.
- [ ] Privacy → Download family data contains only your family.

## Accessibility
- [ ] VoiceOver on iPad: every child button is announced; the step text is read on change.
- [ ] Phone text size at 200%: no clipped controls on Home, Controller, Progress.
- [ ] Reduce Motion on: no entrance animations on the child device.
- [ ] Keyboard only (desktop): the whole controller works with visible focus.
