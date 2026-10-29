import { test, expect } from '@playwright/test';
import { PROJECT, imageNameOf, stackConfig, volumeNameOf } from '../../support/env';
import { AdminApi } from '../../support/api';
import { HEALTH_SERVICES, SERVICES, containerName, docker, inspectService } from '../../support/stack';

test('H-STACK-01 all five containers of the stack are healthy and the init service has made the secrets @smoke @harness', async () => {
  // Six `docker inspect` calls take more than the default 60 s when the machine is busy (seen while `stack.sh up` ran
  // next to a full matrix).
  test.setTimeout(180_000);
  for (const service of HEALTH_SERVICES) {
    const state = await inspectService(service);
    expect(state?.running, `${service} running`).toBe(true);
    expect(state?.health, `${service} health`).toBe('healthy');
  }
  const init = await inspectService('init');
  expect(init?.status, 'init has run and exited').toBe('exited');
  expect(init?.exitCode, 'init exit code').toBe(0);
});

interface Inspected {
  Config: { Labels: Record<string, string>; Env: string[]; Image: string };
  NetworkSettings: {
    Networks: Record<string, { IPAddress: string }>;
    Ports: Record<string, Array<{ HostIp: string; HostPort: string }> | null>;
  };
}

/**
 * Several stacks can run on one machine (E2E_STACK=1..4, README "Parallel stacks"): this proves that the stack the
 * tests talk to is the one the environment selected, and that nothing of it belongs to another project: the compose
 * project label, the network with its subnet and fixed addresses, the published ports and the public URL.
 */
test('H-STACK-02 the stack belongs to the selected project: names, network, subnet, addresses, published ports and public URL @smoke @harness', async () => {
  const config = stackConfig();
  const inspected = new Map<string, Inspected>();
  for (const service of SERVICES) {
    const result = await docker(['inspect', containerName(service)], { check: true });
    inspected.set(service, (JSON.parse(result.stdout) as Inspected[])[0]!);
  }
  const published = (service: string, port: string) =>
    (inspected.get(service)!.NetworkSettings.Ports[port] ?? [])
      .map((binding) => `${binding.HostIp}:${binding.HostPort}`)
      .sort();
  const hostPorts = (service: string, port: string) => [
    ...new Set(
      (inspected.get(service)!.NetworkSettings.Ports[port] ?? []).map(
        (binding) => binding.HostPort,
      ),
    ),
  ];

  // Caddy, API and LiveKit share "studioflow"; API and PostgreSQL share "backend" (LiveKit cannot reach the database).
  const addresses: Record<(typeof SERVICES)[number], Record<string, string>> = {
    caddy: { [config.network]: config.ips.caddy },
    livekit: { [config.network]: config.ips.livekit },
    api: { [config.network]: config.ips.api, [config.backendNetwork]: config.backendIps.api },
    postgres: { [config.backendNetwork]: config.backendIps.postgres },
  };
  for (const service of SERVICES) {
    const info = inspected.get(service)!;
    expect(info.Config.Labels['com.docker.compose.project'], `${service}: compose project`).toBe(
      PROJECT,
    );
    expect(
      Object.keys(info.NetworkSettings.Networks).sort(),
      `${service}: only the networks it needs, of the project`,
    ).toEqual(Object.keys(addresses[service]).sort());
    for (const [name, address] of Object.entries(addresses[service]))
      expect(
        info.NetworkSettings.Networks[name]!.IPAddress,
        `${service}: fixed address on ${name}, derived from the subnet`,
      ).toBe(address);
  }
  for (const service of ['api', 'caddy'] as const) {
    expect(inspected.get(service)!.Config.Image, `${service}: image of the project`).toBe(
      imageNameOf(service),
    );
  }

  const network = JSON.parse(
    (await docker(['network', 'inspect', config.network], { check: true })).stdout,
  ) as Array<{ IPAM: { Config: Array<{ Subnet: string }> } }>;
  expect(
    network[0]!.IPAM.Config.map((entry) => entry.Subnet),
    'subnet of the compose network',
  ).toEqual([config.subnet]);
  const backend = JSON.parse(
    (await docker(['network', 'inspect', config.backendNetwork], { check: true })).stdout,
  ) as Array<{ IPAM: { Config: Array<{ Subnet: string }> } }>;
  expect(
    backend[0]!.IPAM.Config.map((entry) => entry.Subnet),
    'subnet of the backend network',
  ).toEqual([config.backendSubnet]);

  // Caddy: the https and http ports; the media ports of LiveKit with equal host and container port; the test-only
  // ports of API, LiveKit and PostgreSQL on 127.0.0.1.
  expect(hostPorts('caddy', `${config.httpsPort}/tcp`), 'Caddy https port').toEqual([String(config.httpsPort)]);
  expect(hostPorts('caddy', `${config.httpsPort}/udp`), 'Caddy https UDP port').toEqual([String(config.httpsPort)]);
  expect(
    Object.entries(inspected.get('caddy')!.NetworkSettings.Ports).filter(([, bindings]) => (bindings ?? []).length > 0).map(([port]) => port).sort(),
    'Caddy publishes the one https port (tcp and udp) and nothing else: no port 80, no admin API',
  ).toEqual([`${config.httpsPort}/tcp`, `${config.httpsPort}/udp`].sort());
  expect(hostPorts('livekit', `${config.rtcTcpPort}/tcp`), 'LiveKit media TCP port').toEqual([
    String(config.rtcTcpPort),
  ]);
  expect(hostPorts('livekit', `${config.rtcUdpPort}/udp`), 'LiveKit media UDP port').toEqual([
    String(config.rtcUdpPort),
  ]);
  expect(published('api', '8080/tcp'), 'direct API').toEqual([
    `127.0.0.1:${new URL(config.apiDirect).port}`,
  ]);
  expect(published('livekit', '7880/tcp'), 'LiveKit signalling').toEqual([
    `127.0.0.1:${new URL(config.livekitAdmin).port}`,
  ]);
  expect(published('postgres', '5432/tcp'), 'PostgreSQL').toEqual([
    `127.0.0.1:${config.postgresPort}`,
  ]);

  // The API builds absolute links from the address of the server settings, which carries the https port.
  const admin = await AdminApi.login();
  expect((await admin.getSystemInfo()).body.publicBaseUrl, 'public base URL of the API').toBe(config.baseURL);
  expect(new URL(config.baseURL).port, 'public URL port').toBe(
    config.httpsPort === 443 ? '' : String(config.httpsPort),
  );

  // The data of the project lives in volumes of the project.
  const volumes = (
    await docker(
      [
        'volume',
        'ls',
        '--filter',
        `label=com.docker.compose.project=${PROJECT}`,
        '--format',
        '{{.Name}}',
      ],
      { check: true },
    )
  ).stdout
    .split(/\r?\n/)
    .filter(Boolean);
  for (const name of ['pgdata', 'media', 'keys', 'caddy_data', 'secrets', 'caddy_certs', 'caddy_admin', 'livekit_config', 'backup_config', 'backups'])
    expect(volumes, `volume ${name}`).toContain(volumeNameOf(name));
});
