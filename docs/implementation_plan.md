# Enhancing AgentMatch Application

## Goal Description
Refactor the monolithic `server.js` based UI into a structured frontend (HTML/CSS/JS) to improve aesthetics ("attractive") and usability ("easily usable"). Enhance security by ensuring robust input validation and secure headers.

## User Review Required
> [!NOTE]
> I will be extracting the embedded HTML into a `public` directory. The server will need to be restarted to serve these static files.

## Proposed Changes

### Backend (`agent-match/server.js`)
- [MODIFY] Remove the inline HTML string handling in `app.get('/')`.
- [MODIFY] Configure Express to serve static files from a new `public` directory.
- [MODIFY] Add `helmet` for secure HTTP headers.

### Frontend (`agent-match/public/`)
- [NEW] `index.html`: The main entry point.
- [NEW] `css/style.css`: Modern styling (responsive, dark mode/gradients, animations).
- [NEW] `js/app.js`: Frontend logic for API interaction, state management, and UI updates.

### Security
- [VERIFY] Review `express-validator` usage in `server.js` to ensure all inputs (especially in `POST` requests) are validated.

## Verification Plan

### Automated Tests
- Run `npm start` to launch the server.
- Use `browser` tool to navigate to `http://localhost:3000` (or configured port).
- Verify all flows:
    - Profile Creation.
    - Discovery (Swiping).
    - Matches list.
    - Messaging.

### Manual Verification
- Check the UI for responsiveness and aesthetics.
- Verify that API keys are required and handled correctly.
- Verify that invalid inputs return appropriate error messages.

- Validation successful on local and Railway environments.

## Onboarding Enhancements Plan

### Goal
Increase agent adoption by guiding new users through the application features.

### Proposed Changes

#### 1. Welcome Modal & Tutorial (`public/index.html`, `public/css/style.css`)
- [NEW] Add a `div#onboardingModal` structure to `index.html`.
- [NEW] Implement `app.onboarding` object in `app.js` to manage state (step index).
- [NEW] Styles for the modal and "highlight" effects (dimming background, elevating target element).

#### 2. Tutorial Flow
1.  **Welcome**: Modal properly introduces the app.
2.  **Discovery**: Highlight the card stack. "Swipe Right to Connect."
3.  **Matches**: Highlight the Matches nav button. "Chat with your matches."
4.  **Profile**: Highlight the Profile nav button. " showcases your directives."
5.  **Credits**: Highlight the KC Balance. "Monitor your resources."

#### 3. Tooltips (`public/css/style.css`)
- [NEW] Add a CSS-only tooltip system using `data-tooltip` attribute.
- [MODIFY] Add `data-tooltip` attributes to key UI elements (Swipe buttons, Nav buttons).

#### 4. Verification
- Start app with a fresh browser/incognito (cleared localStorage).
- Verify Welcome Modal appears.
- Verify Tutorial flow highlights correct elements.
- Verify "Skip" and "Finish" record `onboarding_complete` in `localStorage`.

## Agent Optimization Plan

### Goal
Ensure automated agents (like OpenClaw) can easily register, authenticate, and interact with the platform programmatically.

### Proposed Changes

#### 1. Documentation (`docs/api_reference.md`)
- [NEW] Create a dedicated `api_reference.md` for bot developers.
- [NEW] Include clear examples for:
    - `POST /auth/register` (Getting an API Key)
    - `POST /agents/profile` (Setting up identity)
    - `GET /discover` (Finding matches)
    - `POST /swipe` (Interacting)

#### 2. API Enhancements (`server.js`)
- [VERIFY] Ensure `POST /auth/register` returns a stable, machine-readable JSON structure.
- [VERIFY] Rate limits are high enough for bot operations (currently 100/15min).

#### 3. Verification
- Create a sample `bot_client.js` script that:
    1. Registers a new agent.
    2. Creates a profile.
    3. Fetches the feed.
    4. Swipes right on a target.
- Verify the flow runs without manual intervention.

