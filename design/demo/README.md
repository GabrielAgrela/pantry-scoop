# Pantry Scoop mobile demo

Deliverable: `pantry-scoop-mobile-demo.mp4` — 55.07 seconds, vertical 1080×1920 H.264, 30 fps, silent.

This is actual screen recording of the app being operated in the Codex built-in Browser at a 390×844 phone viewport. It shows searching, stock toggles, recipe requests, saved recipes, nutrition, ingredients, methods, tips and appliance settings. It uses an in-memory sample account with fake authentication and AI responses; no production data was changed.

Recording: attached the current task to the host Codex desktop, captured its live window at 30 fps with FFmpeg, cropped the phone viewport and exported a portrait MP4. `edit-live.py` removes idle pauses and plays retained footage at 1.8× to fit the requested duration. It uses live recordings, not screenshot slides.

Source footage: `pantry-scoop-mobile-live.mp4` and `mobile-details-live.mp4`. `live-edit.json` records the cuts. `demo-server.mjs` starts the sample app at localhost:3214.

Validation: inspected phone UI interactions in the built-in Browser, reviewed actual video frame contact sheets, confirmed 55.07-second duration and 1652 frames with ffprobe, and decoded the full final video without errors.
