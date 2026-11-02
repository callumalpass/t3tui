import {
  ORCHESTRATION_PROTOCOL_QUERY_PARAM,
  ORCHESTRATION_PROTOCOL_VERSION,
  WsRpcGroup,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import type * as Scope from "effect/Scope";
import * as RpcClient from "effect/rpc/RpcClient";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import * as Socket from "effect/socket/Socket";

import {
  issueLocalCredential,
  readCredential,
  resolveLocalServer,
  resolveSocketUrl,
  UnauthorizedError,
  type ServerTarget,
  type StoredCredential,
} from "./auth.ts";

const makeProtocolClient = RpcClient.make(WsRpcGroup);
export type T3Rpc = Effect.Success<typeof makeProtocolClient>;

export interface Connection {
  readonly rpc: T3Rpc;
  readonly target: ServerTarget;
  /** For the HTTP endpoints, such as older thread history. */
  readonly credential: StoredCredential;
}

const socketUrlFor = async (target: ServerTarget) => {
  const protocol = { param: ORCHESTRATION_PROTOCOL_QUERY_PARAM, version: ORCHESTRATION_PROTOCOL_VERSION };
  const existing = await readCredential(target);
  if (existing) {
    try {
      return { url: await resolveSocketUrl(target, existing, protocol), credential: existing };
    } catch (error) {
      // A revoked or expired token falls through to a fresh one; T3TUI_TOKEN never does.
      if (!(error instanceof UnauthorizedError) || process.env.T3TUI_TOKEN) throw error;
    }
  }
  const credential = await issueLocalCredential(target);
  return { url: await resolveSocketUrl(target, credential, protocol), credential };
};

/** Opens one authenticated socket to the T3 Code server for the life of the scope. */
export const connect: Effect.Effect<Connection, Error, Scope.Scope> = Effect.gen(function* () {
  const target = yield* Effect.tryPromise({ try: resolveLocalServer, catch: toError });
  const { url: socketUrl, credential } = yield* Effect.tryPromise({ try: () => socketUrlFor(target), catch: toError });
  const protocol = Layer.effect(
    RpcClient.Protocol,
    RpcClient.makeProtocolSocket({
      pingTimeout: "15 seconds",
      retryTransientErrors: false,
      retryPolicy: Schedule.recurs(0),
    }),
  ).pipe(
    Layer.provide(
      Layer.mergeAll(
        Socket.layerWebSocket(socketUrl, { openTimeout: "15 seconds" }).pipe(
          Layer.provide(Socket.layerWebSocketConstructorGlobal),
        ),
        RpcSerialization.layerJson,
      ),
    ),
  );
  const context = yield* Layer.build(protocol);
  const rpc = yield* makeProtocolClient.pipe(Effect.provide(context));
  return { rpc, target, credential };
});

const toError = (cause: unknown) => (cause instanceof Error ? cause : new Error(String(cause)));
