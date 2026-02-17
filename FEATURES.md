# CollabBoard: MVP Feature Checklist

## Phase Context

[cite_start]We are currently building the **24-Hour MVP**[cite: 18]. [cite_start]The absolute highest priority is a simple whiteboard with bulletproof multiplayer synchronization[cite: 34]. Do not implement any AI agent features yet, BUT ensure all canvas objects use strict Zod schemas so they are ready for AI function calling in Phase 2.

## Build Strategy (Priority Order)

[cite_start]Please implement features in this exact order to ensure vertical stability[cite: 124]:

1. [cite_start]**Cursor Sync:** Get two cursors moving across browsers[cite: 115, 116].
2. [cite_start]**Object Sync:** Create sticky notes that appear for all users[cite: 117, 118].
3. [cite_start]**Conflict Handling:** Handle simultaneous edits gracefully[cite: 119].
4. [cite_start]**State Persistence:** Survive refreshes and reconnects[cite: 120].
5. [cite_start]**Board Features:** Expand to shapes, connectors, and transforms[cite: 121].

---

## 1. Core Infrastructure & Access

- [ ] [cite_start]**User Authentication:** Integrate Clerk for simple user login/auth[cite: 31].
- [ ] [cite_start]**Public Deployment:** The app must be deployed and publicly accessible (Firebase for frontend, Cloudflare for backend)[cite: 33].

## 2. Real-Time Collaboration Layer

- [ ] [cite_start]**Live Cursors:** Multiplayer cursors that show real-time movement and display user name labels[cite: 30, 40].
- [ ] [cite_start]**Presence Awareness:** Clear UI indication of exactly who is currently online on the board[cite: 31, 40].
- [ ] [cite_start]**Instant Sync:** Object creation and modifications must appear instantly for all connected users[cite: 40].
- [ ] [cite_start]**Conflict Resolution:** Handle simultaneous edits appropriately (last-write-wins is acceptable)[cite: 40].
- [ ] [cite_start]**State Persistence:** The board state must survive all users leaving and returning (via Cloudflare SQLite)[cite: 40].
- [ ] [cite_start]**Resilience:** Graceful handling of network disconnects and reconnects[cite: 40].

## 3. Core Canvas Features

- [ ] [cite_start]**Infinite Workspace:** Smooth panning and zooming across an infinite board[cite: 24, 37].
- [ ] [cite_start]**Sticky Notes:** Users can create, edit text within, and change the colors of sticky notes[cite: 25, 37].
- [ ] [cite_start]**Shapes:** Support for rectangles, circles, and lines with solid colors[cite: 26, 37].
- [ ] [cite_start]**Connectors:** Lines or arrows that connect different objects together[cite: 37].
- [ ] [cite_start]**Text Elements:** Standalone text elements on the board[cite: 37].
- [ ] [cite_start]**Frames:** Ability to group and organize content areas[cite: 38].
- [ ] [cite_start]**Transforms:** Users can move, resize, and rotate objects[cite: 27, 38].
- [ ] [cite_start]**Selection:** Single and multi-select support (shift-click, drag-to-select)[cite: 38].
- [ ] [cite_start]**Operations:** Support for deleting, duplicating, and copy/pasting objects[cite: 38].

## 4. Performance Targets (To Maintain)

- [ ] [cite_start]**Frame Rate:** 60 FPS during pan, zoom, and object manipulation[cite: 49].
- [ ] [cite_start]**Sync Latency:** Object sync latency must remain <100ms[cite: 49].
- [ ] [cite_start]**Cursor Latency:** Cursor sync latency must remain <50ms[cite: 49].
- [ ] [cite_start]**Capacity:** Handle 500+ objects without performance drops[cite: 49].
- [ ] [cite_start]**Concurrency:** Support 5+ concurrent users without degradation[cite: 47, 49].
