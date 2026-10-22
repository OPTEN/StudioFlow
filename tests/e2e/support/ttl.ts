import { AdminApi, PublicApi } from './api';
import { COMPOSE_FILES, stackConfig } from './env';
import { uniqueIp } from './production';
import { containerName, docker, recreateApi, recreateLiveKit } from './stack';

/**
 * The short-TTL profile of docs/testing.md 1.2.6 [GAP-01]: the api container is recreated with the Pairing:* and
 * LiveKit:TokenTtl keys of docker-compose.short-ttl.yml and back. A key the API does not read yet is silently ignored by
 * ASP.NET Core, so every dependent spec probes what the running build supports and skips with an explicit reason.
 */
export interface TtlSupport {
  /** Pairing:InviteTtl: a phone invite lives about 20 s. */
  invite: boolean;
  /** Pairing:RequestTtl: a knock request lives about 20 s. */
  request: boolean;
  /** Pairing:Limits:PendingTotal = 3. */
  pendingTotal: boolean;
  /** LiveKit:TokenTtl: tokens live about 60 s. */
  tokenTtl: boolean;
  /** The compose override reached the container (so a missing effect is the API's, not the harness's). */
  envPassed: boolean;
  /** Observed lifetimes in seconds (diagnostics). */
  observed: { invite: number; request: number; token: number };
}

export async function useShortTtl(): Promise<void> {
  await recreateApi([COMPOSE_FILES.shortTtl]);
}

export async function useDefaultTtl(): Promise<void> {
  await recreateApi([]);
}

export async function probeTtlSupport(): Promise<TtlSupport> {
  const config = stackConfig();
  const admin = await AdminApi.login(config.baseURL, config.admin);
  const active = (await admin.getActiveProduction()).body;
  const invite = (await admin.renewPhoneInvite(active.id)).body;
  const inviteSeconds = (new Date(invite.expiresAt).getTime() - new Date(invite.createdAt).getTime()) / 1000;

  const publicApi = new PublicApi(config.apiDirect, uniqueIp());
  const knock = await publicApi.createPairingRequest({ name: 'TTL probe', kind: 'laptop', platform: 'Node' });
  const requestSeconds = (new Date(knock.body.expiresAt).getTime() - Date.now()) / 1000;
  await publicApi.cancelPairingRequest(knock.body.requestId, knock.body.pollToken);

  // Pending cap: three requests from three addresses pass, the fourth is refused when PendingTotal is 3.
  const created: Array<{ requestId: string; pollToken: string }> = [];
  let capped = false;
  for (let index = 0; index < 4; index++) {
    const response = await new PublicApi(config.apiDirect, uniqueIp()).createPairingRequest({ name: `Cap ${index}`, kind: 'laptop', platform: 'Node' });
    if (response.status === 201) created.push(response.body);
    else if (response.status === 429) capped = true;
  }
  for (const request of created) await new PublicApi(config.apiDirect).cancelPairingRequest(request.requestId, request.pollToken);

  const token = (await admin.getStudioLiveKitToken(active.id)).body;
  const tokenSeconds = (new Date(token.expiresAt).getTime() - Date.now()) / 1000;
  const env = await docker(['inspect', '-f', '{{json .Config.Env}}', containerName('api')]);
  return {
    envPassed: env.stdout.includes('PAIRING__INVITETTL=00:00:20') && env.stdout.includes('PAIRING__REQUESTTTL=00:00:20'),
    invite: inviteSeconds > 0 && inviteSeconds <= 25,
    request: requestSeconds > 0 && requestSeconds <= 25,
    pendingTotal: capped && created.length === 3,
    tokenTtl: tokenSeconds > 0 && tokenSeconds <= 90,
    observed: { invite: Math.round(inviteSeconds), request: Math.round(requestSeconds), token: Math.round(tokenSeconds) },
  };
}

/** LiveKit with room.empty_timeout 10 s (the short profile of docs/testing.md 1.2.6); the API keeps its settings. */
export async function useShortTtlLiveKit(): Promise<void> {
  await recreateLiveKit([COMPOSE_FILES.shortTtl]);
}

export async function useDefaultTtlLiveKit(): Promise<void> {
  await recreateLiveKit([]);
}
