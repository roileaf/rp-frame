# RP Frame

Shared roleplay scenes with optional StoryFrame integration. Requires socketlib; Foundry VTT 13–14.

## Use

Enable **RP Frame** and **socketlib** in Manage Modules. StoryFrame is optional. Disable Raise My Hand's RP queue (or that module) to avoid overlapping controls and banners. RP Frame has its own settings and socket namespace; it does not change either existing module.

- Players click **RP Frame — join scene** to request a scene. The GM clicks **start scene** to approve the queue and give the first participant the spotlight.
- During a scene, players join/leave, flag an urgent request, finish speaking, or delay their turn. Finishing moves the speaker to the back and advances the next participant, urgent first. Finishing as the last participant ends the scene.
- GMs use **start scene** / **end scene** in token controls. Click a queue chip to choose; right-click to remove.
- The speaker banner shows **You are speaking** or **Name speaks**. When the GM socket is unavailable, the same banner keeps its portrait and queue and reads **Waiting for GM**. No waiting banner remains after the scene ends.
- Drag the banner to move it; drag its corner to resize. Layout and visibility are per client. Queue badges appear beside player names and on cameras.
- Scenes persist through GM refresh. Offline participants are retained so a refresh does not reorder the queue. Commands wait for a ready GM socket; slow heartbeat replies have a five-second deadline.
- Combat automatically ends RP scenes by default. Disable this in RP Frame settings if desired.

Default shortcuts, editable in Foundry's **Configure Controls**: **H** requests/leaves the queue, **X** toggles urgent speak, **Space** takes/finishes spotlight (GM: approve/end scene), and **Shift+Space** delays your speaking turn. H cannot remove the active speaker; use Space to finish.

## Voice glow

Optional, off by default. Everything lives in one window: **Configure Settings → RP Frame: voice glow → Open**. When the GM turns it on, a talking player's character tokens get a soft green glow and their camera tile a green halo. The current RP speaker keeps only the solid speaker ring.

The window has three sections, and every control saves as soon as you change it:

- **Table:** GMs get **Voice glow for this world**. Players see whether it's on instead.
- **My mic:** **Use my mic for voice glow** (turn it off to opt out at any time). **Test mic** opens a live level meter so you can set the threshold slider: raise it if background noise triggers the glow, lower it if quiet speech doesn't. The test only runs while you ask for it, works even when voice glow is off, and stops when you press **Stop test** or close the window.
- **What I see:** **Show voice glow** hides glows on your own screen only (token and camera). Below it, **Token glow** and **Camera glow** each have their own on/off checkbox (so you can keep only the token glow or only the camera glow) and their own color, size, brightness and opacity controls with a live preview, so the token glow and the camera halo can look different. They affect your own screen only; other players keep their own look. Each part's **Reset to default** restores only that part to the original green.
- **Privacy:** each player's browser measures its own mic *volume level* locally. No audio is sent, recorded or stored; only "talking / not talking" and a mic status are shared.
- **Consent:** the first time it's enabled, each player is asked before the mic is used. **No thanks** opts that player out.
- **Muted mics:** GMs see a muted-mic mark on the cameras of players whose mic is off, blocked or unavailable.
- **Voice chat mute:** voice glow listens to the mic directly, so Foundry's own A/V mute doesn't silence it. If you use push-to-talk in your voice app, turn on push-to-talk below; otherwise opt out if that's a problem.
- **Background tabs:** browsers throttle timers in hidden or fully covered tabs, so detection gets coarse (late or missed glows) while Foundry isn't visible.

**Push-to-talk:** if you use push-to-talk in Discord or another voice app, turn on **Push-to-talk: glow only while I hold my talk key** under My mic. You then glow only while you hold your talk key or mouse button *and* your mic is above the threshold, like Discord's own indicator. Set the same key as your voice app in **Configure Controls → RP Frame: push-to-talk** (no default), or pick **Mouse 4 (Back)** or **Mouse 5 (Forward)** under **Mouse button**; that button then doesn't trigger the browser's Back/Forward in Foundry. Foundry must be focused to see your key or button, so you won't glow while alt-tabbed to another window. **Test mic** follows the same rule while push-to-talk is on.

## StoryFrame integration

With StoryFrame active and **follow StoryFrame spotlight** enabled, RP Frame highlights an existing visible StoryFrame speaker matching the participant's assigned character or user ID. Add characters to StoryFrame first. RP Frame does not create/delete StoryFrame speakers or replace journals. Ending the scene restores the prior spotlight, unless the GM independently selected another speaker.

## API

`game.modules.get('rp-frame').api` exposes `getState()`, `isGmConnected()`, `start()`, `end()`, `join()`, `finish()`, `urgent()`, and `command(type, userId)`. With StoryFrame active, the same API is available at `game.storyframe.rpFrame`. Commands authenticate the actual socket sender; GM operations are rejected for players. `rpFrameStateChanged` receives a copy of each applied scene snapshot.

## Development

Run `npm test` or `node --test tests/*.test.mjs`. State, persistence ordering, authenticated socket commands, GM connection races, speaker presentation, and StoryFrame integration are independently testable.

This module is a new implementation of the RP scene behavior developed for the local Raise My Hand fork. It does not import or require Raise My Hand's code, assets, settings, or sockets.
