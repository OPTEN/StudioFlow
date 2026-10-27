import type { Namespace } from '../../types';

/**
 * The first-run wizard after the account (media address, address and certificate, embedding) and the "Server settings"
 * page of the Regie (issue #27): the same sections in both places, plus the backup schedule and the latest backups.
 */
export const regieServer = {
  // --- the page and what both places share
  'regie.server.title': 'Server settings',
  'regie.server.menu': 'Server settings',
  'regie.server.back': 'Back to the control room',
  'regie.server.loading': 'Loading the settings …',
  'regie.server.loadError': 'The settings could not be loaded.',
  'regie.server.retry': 'Try again',
  'regie.server.save': 'Save',
  'regie.server.saving': 'Saving …',
  'regie.server.saved': 'Saved.',
  'regie.server.apply.timeout':
    'The services have not taken over the settings yet. Check: docker compose ps',
  'regie.server.apply.caddy':
    'The web server (Caddy) refused the settings. Check: docker compose logs api caddy',
  'regie.server.apply.liveKit':
    'The media server (LiveKit) did not restart. Check: docker compose logs livekit',
  'regie.server.apply.backup':
    'The backup service has not taken over the settings yet. Check: docker compose ps backup',
  'regie.server.status.heading': 'Services',
  'regie.server.status.caddy': 'Web server',
  'regie.server.status.liveKit': 'Media server',
  'regie.server.status.backup': 'Backup service',
  'regie.server.status.ok': 'runs the saved settings',
  'regie.server.status.pending': 'is taking over the settings …',
  'regie.server.status.failed': 'refused the settings',

  // --- the wizard
  'regie.server.wizard.title': 'Set up the server',
  'regie.server.wizard.lead': 'Set up the server',
  'regie.server.wizard.step': 'Step {current} of {total}',
  'regie.server.wizard.stepsAccount': 'Account',
  'regie.server.wizard.stepsMedia': 'Media address',
  'regie.server.wizard.stepsAddress': 'Address and certificate',
  'regie.server.wizard.stepsEmbedding': 'Embedding',
  'regie.server.wizard.next': 'Save and continue',
  'regie.server.wizard.keep': 'Keep the defaults',
  'regie.server.wizard.finish': 'Save and finish',
  'regie.server.wizard.loadError': 'The wizard could not read the settings of the server.',
  'regie.server.wizard.doneTitle': 'The server is ready',
  'regie.server.wizard.doneText':
    'Open the control room and pair the first phone or laptop. You can change everything here later under "Server settings".',
  'regie.server.wizard.doneOpen': 'Open the control room',
  'regie.server.wizard.doneNewAddress':
    'The control room now also answers at the new address. Devices and browsers use this one from now on; sign in again there.',
  'regie.server.wizard.doneNewAddressLink': 'Open {url}',

  // --- media address
  'regie.server.media.heading': 'Media address',
  'regie.server.media.intro':
    'Cameras, phones and the output exchange picture and sound directly with this server. Enter the IPv4 address of this computer in your network; every device must be able to reach it.',
  'regie.server.media.label': 'IPv4 address of this server',
  'regie.server.media.hint':
    'Find it on the server: Linux "hostname -I", Windows "ipconfig", macOS "ipconfig getifaddr en0". Reserve the address in your router so that it stays the same.',
  'regie.server.media.suggest': 'Use {address}',
  'regie.server.media.suggestFromHost': 'the address you opened this page with',
  'regie.server.media.required': 'Enter the IPv4 address.',
  'regie.server.media.invalid':
    'Enter four numbers from 0 to 255 separated by dots, for example 192.168.1.50.',
  'regie.server.media.test': 'Test connection',
  'regie.server.media.testing': 'Testing …',
  'regie.server.media.testNote':
    'The test restarts the media server for a few seconds and sends a message from this browser through the address and back.',
  'regie.server.media.testOk':
    'The test worked: this browser exchanged data with the media server at {address} (round trip {ms} ms).',
  'regie.server.media.testSignal':
    'The media server does not answer through the web server. Check: docker compose ps livekit caddy',
  'regie.server.media.testTransport':
    'The connection to {address} could not be established. Check that this is the address of the server and that its firewall lets the media ports through (by default 7881/tcp and 7882/udp).',
  'regie.server.media.testData':
    'Connected, but the test message did not come back. Check the firewall and any VPN on this computer, then test again.',
  'regie.server.media.changeNote':
    'Saving a new address restarts the media server. That is not possible while a broadcast is live.',

  // --- address and certificate
  'regie.server.address.heading': 'Address and certificate',
  'regie.server.address.intro':
    'Browsers only open the control room, the output and the pairing page over HTTPS with a certificate they trust. Choose how the server gets one.',
  'regie.server.address.modeLabel': 'Certificate',
  'regie.server.address.modeInternal': 'Local certificate (no domain needed)',
  'regie.server.address.modeCustom': 'My own certificate',
  'regie.server.address.modeDns': 'Let’s Encrypt through DNS: {provider}',
  'regie.server.address.domainLabel': 'Domain',
  'regie.server.address.domainHintInternal':
    'Optional. A name for this server that your devices can resolve, for example studioflow.example.com. Without one the control room is opened by the IP address.',
  'regie.server.address.domainHintPublic':
    'The name the certificate is for, for example studioflow.example.com. Its DNS record must point to this server.',
  'regie.server.address.domainRequired': 'Enter the domain.',
  'regie.server.address.domainInvalid':
    'Enter a host name such as studioflow.example.com: letters, digits and hyphens, with a dot.',
  'regie.server.address.internalNote':
    'The server signs its own certificate. Each browser and phone has to trust the certificate authority of the server once; until then it shows a warning.',
  'regie.server.address.internalDownload': 'Download the CA certificate',
  'regie.server.address.internalInstall':
    'Install it on every device as a trusted root certificate (steps in the runbook).',
  'regie.server.address.dnsNote':
    'The server gets a Let’s Encrypt certificate by publishing a DNS record, so nothing has to be reachable from the internet. The domain must belong to the account of the provider.',
  'regie.server.address.dnsEmailLabel': 'E-mail for expiry notices (optional)',
  'regie.server.address.dnsEmailInvalid': 'Enter a valid e-mail address.',
  'regie.server.address.dnsChallengeLabel': 'Delegated challenge domain (optional)',
  'regie.server.address.dnsChallengeHint':
    'Only if _acme-challenge of the domain is a CNAME to another zone: enter its target, for example _acme-challenge.studioflow.dedyn.io.',
  'regie.server.address.dnsChallengeInvalid': 'Enter a host name.',
  'regie.server.address.credentialsHeading': 'Access to {provider}',
  'regie.server.address.credentialsHint': 'Stored encrypted on the server and never shown again.',
  'regie.server.address.credentialsStored': 'Saved. Leave empty to keep it.',
  'regie.server.address.credentialsRequired': 'Enter this value.',
  'regie.server.address.credentialsInvalid':
    'This value contains characters or has a length that such a credential does not have.',
  'regie.server.address.credentialToken': 'API token',
  'regie.server.address.credentialAccessKeyId': 'Access key ID',
  'regie.server.address.credentialSecretAccessKey': 'Secret access key',
  'regie.server.address.credentialRegion': 'Region (for example eu-central-1)',
  'regie.server.address.credentialEndpoint': 'Endpoint (for example ovh-eu)',
  'regie.server.address.credentialApplicationKey': 'Application key',
  'regie.server.address.credentialApplicationSecret': 'Application secret',
  'regie.server.address.credentialConsumerKey': 'Consumer key',
  'regie.server.address.customNote':
    'Upload the certificate chain (PEM, the certificate of the server first) and its private key without a password.',
  'regie.server.address.customCertificate': 'Certificate file (PEM)',
  'regie.server.address.customKey': 'Private key file (PEM)',
  'regie.server.address.customCurrent': 'Current certificate: {subject}, valid until {date}.',
  'regie.server.address.customNames': 'Names: {names}',
  'regie.server.address.customKeep': 'Choose both files to replace it.',
  'regie.server.address.customFileRequired': 'Choose the file.',
  'regie.server.address.customReadError': 'The file could not be read.',
  'regie.server.address.errorCertificateRequired': 'Upload a certificate first.',
  'regie.server.address.errorCertificateInvalid': 'This is not a PEM certificate.',
  'regie.server.address.errorPrivateKeyInvalid': 'This is not a PEM private key.',
  'regie.server.address.errorPrivateKeyEncrypted':
    'The key is protected by a password. Remove the password first (openssl rsa -in key.pem -out key-plain.pem).',
  'regie.server.address.errorKeyMismatch': 'The key does not belong to the certificate.',
  'regie.server.address.errorExpired': 'The certificate has expired.',
  'regie.server.address.errorNotYetValid': 'The certificate is not valid yet.',
  'regie.server.address.errorNameMismatch': 'The certificate does not cover the domain.',
  'regie.server.address.errorTlsMode': 'This certificate mode is not available.',
  'regie.server.address.warning':
    'Paired phones, laptops and output links open the address they were paired with. After a change of the domain or the certificate they have to open {url} instead.',
  'regie.server.address.newUrl': 'The control room will then be at {url}',
  'regie.server.address.openNew': 'Open {url}',

  // --- embedding
  'regie.server.embedding.heading': 'Embedding the output',
  'regie.server.embedding.intro':
    'The output can be shown inside a web page of these origins, for example in a streaming proxy. The control room itself can never be embedded.',
  'regie.server.embedding.label': 'Allowed origins, one per line',
  'regie.server.embedding.hint':
    'For example https://proxy.example.ch or https://*.example.com. Leave empty to allow none.',
  'regie.server.embedding.invalid':
    'Line {line} is not an origin. Use https://host or https://*.host, optionally with a port.',
  'regie.server.embedding.tooMany': 'At most {max} origins are possible.',

  // --- backups
  'regie.server.backup.heading': 'Backups',
  'regie.server.backup.intro':
    'The backup service copies the database, the login keys, the certificates and the media to the backups volume of this server. A scheduled backup never starts while a broadcast is live; it waits for the end.',
  'regie.server.backup.scheduleLabel': 'Schedule',
  'regie.server.backup.scheduleHint':
    'Five fields as in cron, for example 0 3 * * * for every day at 03:00. Empty: no automatic backups.',
  'regie.server.backup.scheduleInvalid':
    'This is not a schedule of five fields (minute, hour, day, month, weekday).',
  'regie.server.backup.timezoneLabel': 'Time zone of the schedule',
  'regie.server.backup.timezoneHint': 'For example Europe/Zurich. Empty: UTC.',
  'regie.server.backup.timezoneInvalid': 'Enter a time zone name such as Europe/Zurich.',
  'regie.server.backup.keepDailyLabel': 'Daily backups kept',
  'regie.server.backup.keepWeeklyLabel': 'Weekly backups kept',
  'regie.server.backup.keepInvalid': 'Enter a whole number from {min} to {max}.',
  'regie.server.backup.offsiteHeading': 'Off-site copy',
  'regie.server.backup.offsiteIntro':
    'Copies every backup to a second place with rclone (S3-compatible storage, SFTP and others). What leaves the server is encrypted with age.',
  'regie.server.backup.offsiteRemoteLabel': 'rclone remote',
  'regie.server.backup.offsiteRemoteHint':
    'Name and folder, for example offsite:studioflow. Empty: no off-site copy.',
  'regie.server.backup.offsiteRemoteInvalid': 'Use the form name:folder.',
  'regie.server.backup.offsiteRemoteNotInConfig':
    'The configuration does not define a remote with this name.',
  'regie.server.backup.offsiteConfigLabel': 'rclone configuration',
  'regie.server.backup.offsiteConfigHint':
    'The text of rclone.conf with the remote above. It is stored encrypted and never shown again.',
  'regie.server.backup.offsiteConfigStored':
    'A configuration is stored. Paste a new one to replace it.',
  'regie.server.backup.offsiteConfigInvalid':
    'This is not an rclone configuration: it needs a section such as [offsite].',
  'regie.server.backup.offsiteAgeLabel': 'Public age keys, one per line',
  'regie.server.backup.offsiteAgeHint':
    'Created with age-keygen. Keep the private key away from this server: only its holder can read the off-site copy.',
  'regie.server.backup.offsiteAgeInvalid':
    'Line {line} is not a public age key (it starts with age1).',
  'regie.server.backup.offsiteAgeRequired':
    'Enter at least one public age key, or confirm below that the remote encrypts by itself.',
  'regie.server.backup.offsiteUnencrypted': 'The remote encrypts by itself (upload without age)',
  'regie.server.backup.listHeading': 'Latest backups',
  'regie.server.backup.listEmpty': 'There is no backup yet.',
  'regie.server.backup.listNow': 'Back up now',
  'regie.server.backup.listRequested':
    'The backup was requested. It appears in the list when it is done.',
  'regie.server.backup.listRunning': 'A backup is running …',
  'regie.server.backup.listPostponed': 'A backup waits for the end of the broadcast.',
  'regie.server.backup.listNotSeen':
    'The backup service has not reported yet. Check: docker compose ps backup',
  'regie.server.backup.listFailed': 'The last backup failed. Check: docker compose logs backup',
  'regie.server.backup.listAuto': 'automatic',
  'regie.server.backup.listManual': 'manual',
  'regie.server.backup.listRestore':
    'Restoring is a command on the server: docker compose run --rm backup restore <folder>. The runbook describes it.',
} as const satisfies Namespace<'regie.server'>;
