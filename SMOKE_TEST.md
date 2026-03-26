# Connection smoke test

## What it verifies

- router is reachable on `PORT` (default `3800`)
- embedded WebSocket bridge is reachable on `BRIDGE_WS_PORT` (default `9300`)
- a `/trigger` request causes the bridge to emit at least one agent message

## Prerequisites

- install deps: `npm install`
- set any auth/env your local router needs in `.env`
- for the default local-dev setup, keep `ALLOW_LOCAL_UNAUTHENTICATED=true`

## Run

Start the backend:

```bash
PORT=3800 BRIDGE_WS_PORT=9300 npm start
```

In another shell run the smoke test:

```bash
PORT=3800 BRIDGE_WS_PORT=9300 npm run smoke:connection
```

## Expected result

The smoke test prints JSON with:

- `ok: true`
- `triggerStatus: 202`
- a non-empty `bridgeMessageType`
- a `bridgeTicketId` like `smoke-xcode-agent-1`

## Notes

- the bridge is created by `src/router.ts`; you do not need a separate `npm run bridge`
- the UI should point its bridge WebSocket client at `BRIDGE_WS_PORT`
