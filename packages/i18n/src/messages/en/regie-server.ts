import type { Namespace } from '../../types';

/**
 * The first-run wizard after the account (media server, address and certificate, embedding) and the server pages of the
 * settings window (issue #27): the same sections in both places, plus the backup schedule and the latest backups.
 */
export const regieServer = {
  // --- what the server pages and the wizard share
  'regie.server.menu': 'Server settings',
  'regie.server.loading': 'Loading the settings…',
  'regie.server.loadError': 'The settings could not be loaded.',
  'regie.server.loadErrorHint': 'Check that the server is running, then try again.',
  'regie.server.retry': 'Try again',
  'regie.server.save': 'Save',
  'regie.server.saving': 'Saving…',
  'regie.server.saved': 'Saved.',
  'regie.server.onAir': 'Not possible while the broadcast is on air. End the broadcast first.',
  'regie.server.details.summary': 'Technical details',
  'regie.server.details.run': 'For whoever runs the server, this command shows more:',
  'regie.server.apply.timeout':
    'The services have not taken over the settings yet. The status at the top of the page shows when they do.',
  'regie.server.apply.caddy':
    'The web server did not accept the settings. The previous settings stay active.',
  'regie.server.apply.liveKit': 'The media server did not restart with the new address.',
  'regie.server.apply.backup':
    'The backup service has not taken over the settings yet. They are saved and apply as soon as it runs.',
  'regie.server.status.label': 'Status',
  'regie.server.status.caddy': 'Web server',
  'regie.server.status.liveKit': 'Media server',
  'regie.server.status.backup': 'Backup service',
  'regie.server.status.ok': 'Running with the saved settings',
  'regie.server.status.pending': 'Taking over the new settings…',
  'regie.server.status.failed': 'Did not take over the saved settings',
  'regie.server.status.unknown': 'Checking…',
  'regie.server.status.unreachable': 'The status could not be read. The next check follows soon.',
  'regie.server.status.checked': 'Checked at {time}',

  // --- the wizard
  'regie.server.wizard.title': 'Set up the server',
  'regie.server.wizard.steps': 'Setup steps',
  'regie.server.wizard.stepsAccount': 'Account',
  'regie.server.wizard.stepsMedia': 'Media server',
  'regie.server.wizard.stepsAddress': 'Address',
  'regie.server.wizard.stepsEmbedding': 'Embedding',
  'regie.server.wizard.stepsDone': 'Done',
  'regie.server.wizard.stepDone': 'completed',
  'regie.server.wizard.mediaTitle': 'Connect the media server',
  'regie.server.wizard.mediaLead':
    'Cameras, phones and the output exchange picture and sound directly with this server. Enter the address of this computer in your network.',
  'regie.server.wizard.addressTitle': 'Choose how browsers reach the server',
  'regie.server.wizard.addressLead':
    'Browsers open the control room, the output and the pairing page only over HTTPS, with a certificate they trust.',
  'regie.server.wizard.embeddingTitle': 'Allow websites to show the output',
  'regie.server.wizard.embeddingLead':
    'Add the page that shows the output to your audience, for example your streaming proxy.',
  'regie.server.wizard.next': 'Save and continue',
  'regie.server.wizard.finish': 'Save and finish',
  'regie.server.wizard.back': 'Back',
  'regie.server.wizard.keep': 'Keep the defaults',
  'regie.server.wizard.keepAddress':
    'Keep the defaults: the server keeps its local certificate and is opened by its IP address. You can change this later in Settings.',
  'regie.server.wizard.keepEmbedding':
    'Keep the defaults: no other website may show the output. You can add websites later in Settings.',
  'regie.server.wizard.loadError': 'The wizard could not read the settings of the server.',
  'regie.server.wizard.doneTitle': 'The server is ready',
  'regie.server.wizard.doneText':
    'Open the control room and add the first phone or laptop. You can change these settings any time in Settings.',
  'regie.server.wizard.doneOpen': 'Open the control room',
  'regie.server.wizard.doneHere': 'Stay at this address',
  'regie.server.wizard.doneNewAddress':
    'The control room now answers at a new address. Devices use it from now on; open it there and sign in again.',
  'regie.server.wizard.doneNewAddressLink': 'Open {url}',

  // --- media server
  'regie.server.media.heading': 'Media address',
  'regie.server.media.intro':
    'Cameras, phones and the output exchange picture and sound directly with this server through this address.',
  'regie.server.media.label': 'IPv4 address of this server',
  'regie.server.media.hint':
    'Find it on the server: Linux "hostname -I", Windows "ipconfig", macOS "ipconfig getifaddr en0". Reserve the address in your router so that it stays the same.',
  'regie.server.media.suggestions': 'Suggestions',
  'regie.server.media.suggestFromHost': 'Address of this page',
  'regie.server.media.suggestInterface': 'Network of the server',
  'regie.server.media.suggestName': 'Use {address} ({source})',
  'regie.server.media.required': 'Enter the IPv4 address.',
  'regie.server.media.invalid':
    'Enter four numbers from 0 to 255 separated by dots, for example 192.168.1.50.',
  'regie.server.media.testHeading': 'Connection test',
  'regie.server.media.testLabel': 'Test this address',
  'regie.server.media.testNote':
    'Restarts the media server for a few seconds, then sends a message from this browser through the address and back.',
  'regie.server.media.test': 'Test connection',
  'regie.server.media.testing': 'Testing…',
  'regie.server.media.testOk':
    'The test worked: this browser exchanged data with the media server at {address} (round trip {ms} ms).',
  'regie.server.media.testSignal': 'The media server does not answer through the web server.',
  'regie.server.media.testTransport':
    'The connection to {address} could not be established. Check that this is the address of the server and that its firewall lets the media ports through (7881/tcp and 7882/udp).',
  'regie.server.media.testData':
    'Connected, but the test message did not come back. Check the firewall and any VPN on this computer, then test again.',
  'regie.server.media.changeNote': 'Saving a new address restarts the media server.',

  // --- address and certificate
  'regie.server.address.intro':
    'Browsers open the control room, the output and the pairing page only over HTTPS, with a certificate they trust.',
  'regie.server.address.modeLabel': 'Certificate',
  'regie.server.address.modeInternal': 'Local certificate',
  'regie.server.address.modeInternalText':
    'The server signs its own certificate. Every device trusts it once; no domain is needed.',
  'regie.server.address.recommended': 'Recommended on a LAN',
  'regie.server.address.modeCustom': 'Own certificate',
  'regie.server.address.modeCustomText': 'Upload a certificate and its key that you already have.',
  'regie.server.address.modeDns': 'Let’s Encrypt via DNS',
  'regie.server.address.modeDnsText':
    'A free certificate for your domain, confirmed through your DNS provider. Nothing has to be reachable from the internet.',
  'regie.server.address.provider': 'DNS provider',
  'regie.server.address.providerHint': 'The domain must belong to your account at this provider.',
  'regie.server.address.nameHeading': 'Name',
  'regie.server.address.domainLabel': 'Domain',
  'regie.server.address.domainHintInternal':
    'Optional. A name for this server that your devices can resolve, for example studioflow.example.com. Without one the control room is opened by the IP address.',
  'regie.server.address.domainHintPublic':
    'The name the certificate is for, for example studioflow.example.com. Its DNS record must point to this server.',
  'regie.server.address.domainRequired': 'Enter the domain.',
  'regie.server.address.domainInvalid':
    'Enter a host name such as studioflow.example.com: letters, digits and hyphens, with a dot.',
  'regie.server.address.trustHeading': 'Trust on every device',
  'regie.server.address.internalNote':
    'Every browser and phone has to trust the certificate authority of this server once; until then it shows a warning.',
  'regie.server.address.internalDownload': 'Download the CA certificate',
  'regie.server.address.internalInstall':
    'Install it on every device as a trusted root certificate.',
  'regie.server.address.more': 'More options',
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
  'regie.server.address.customHeading': 'Certificate files',
  'regie.server.address.customNote':
    'The certificate chain (PEM, the certificate of the server first) and its private key without a password.',
  'regie.server.address.customCertificate': 'Certificate file (PEM)',
  'regie.server.address.customKey': 'Private key file (PEM)',
  'regie.server.address.customChoose': 'Choose file…',
  'regie.server.address.customNoFile': 'No file chosen',
  'regie.server.address.customKeep': 'Choose both files only to replace the current certificate.',
  'regie.server.address.currentHeading': 'Current certificate',
  'regie.server.address.currentSubject': 'Issued to',
  'regie.server.address.currentNames': 'Names',
  'regie.server.address.currentExpiry': 'Valid until',
  'regie.server.address.currentFingerprint': 'Fingerprint',
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
  'regie.server.address.newUrl': 'The control room will then be at {url}.',
  'regie.server.address.openNew': 'Open {url}',

  // --- embedding
  'regie.server.embedding.heading': 'Allowed websites',
  'regie.server.embedding.intro':
    'Websites that may show the output, for example your streaming proxy. The control room itself can never be embedded.',
  'regie.server.embedding.row': 'Website {index}',
  'regie.server.embedding.add': 'Add website',
  'regie.server.embedding.remove': 'Remove website {index}',
  'regie.server.embedding.empty': 'No website may show the output yet.',
  'regie.server.embedding.hint':
    'Enter each address as https://host, or https://*.example.com for every subdomain, optionally with a port.',
  'regie.server.embedding.invalid':
    'This is not a website address. Use https://host or https://*.host, optionally with a port.',
  'regie.server.embedding.tooMany': 'At most {max} websites are possible.',

  // --- backups: schedule, keep and the off-site copy
  'regie.server.backup.intro':
    'The backup service copies the database, the login keys, the certificates and the media to the backups volume of this server. A scheduled backup never starts during a broadcast; it waits for the end.',
  'regie.server.backup.scheduleHeading': 'Schedule',
  'regie.server.backup.scheduleLabel': 'Automatic backups',
  'regie.server.backup.presetOff': 'Off',
  'regie.server.backup.presetDaily': 'Daily',
  'regie.server.backup.presetWeekly': 'Weekly',
  'regie.server.backup.presetCustom': 'Custom',
  'regie.server.backup.timeLabel': 'Time',
  'regie.server.backup.dayLabel': 'Day',
  'regie.server.backup.cronLabel': 'Schedule (cron)',
  'regie.server.backup.scheduleHint':
    'Five fields as in cron, for example 0 3 * * 1-5 for 03:00 from Monday to Friday.',
  'regie.server.backup.scheduleInvalid':
    'This is not a schedule of five fields (minute, hour, day, month, weekday).',
  'regie.server.backup.timeInvalid': 'Enter a time such as 03:00.',
  'regie.server.backup.timezoneLabel': 'Time zone',
  'regie.server.backup.timezoneInvalid': 'Enter a time zone name such as Europe/Zurich.',
  'regie.server.backup.nextToday': 'Next backup today at {time}.',
  'regie.server.backup.nextTomorrow': 'Next backup tomorrow at {time}.',
  'regie.server.backup.nextDay': 'Next backup on {day} at {time}.',
  'regie.server.backup.nextOff': 'No automatic backups. “Back up now” still works.',
  'regie.server.backup.nextCustom': 'The server runs this schedule in the chosen time zone.',
  'regie.server.backup.keepHeading': 'Keep',
  'regie.server.backup.keepDailyLabel': 'Daily backups',
  'regie.server.backup.keepWeeklyLabel': 'Weekly backups',
  'regie.server.backup.keepFooter': 'The newest backups are kept; older ones are deleted.',
  'regie.server.backup.keepInvalid': 'Enter a whole number from {min} to {max}.',
  'regie.server.backup.offsiteHeading': 'Off-site copy',
  'regie.server.backup.offsiteSwitch': 'Copy every backup to a second place',
  'regie.server.backup.offsiteIntro':
    'With rclone to S3-compatible storage, SFTP and others. What leaves the server is encrypted with age.',
  'regie.server.backup.offsiteRemoteLabel': 'rclone remote',
  'regie.server.backup.offsiteRemoteHint': 'Name and folder, for example offsite:studioflow.',
  'regie.server.backup.offsiteRemoteRequired': 'Enter the remote, or switch the off-site copy off.',
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

  // --- backups: the latest backups
  'regie.server.backup.listHeading': 'Latest backups',
  'regie.server.backup.listEmpty': 'There is no backup yet.',
  'regie.server.backup.listEmptyHint':
    'The first one appears here after the next scheduled run or after “Back up now”.',
  'regie.server.backup.listNow': 'Back up now',
  'regie.server.backup.listIdle': 'Ready',
  'regie.server.backup.listRequested':
    'The backup was requested. It appears in the list when it is done.',
  'regie.server.backup.listRunning': 'A backup is running…',
  'regie.server.backup.listPostponed': 'A backup waits for the end of the broadcast.',
  'regie.server.backup.listNotSeen': 'The backup service has not reported yet.',
  'regie.server.backup.listFailed': 'The last backup failed.',
  'regie.server.backup.listLoadError': 'The list of backups could not be loaded.',
  'regie.server.backup.listAuto': 'Automatic',
  'regie.server.backup.listManual': 'Manual',
  'regie.server.backup.listColumnName': 'Backup',
  'regie.server.backup.listColumnKind': 'Kind',
  'regie.server.backup.listColumnSize': 'Size',
  'regie.server.backup.listColumnTime': 'Finished',
  'regie.server.backup.listCaption': 'The latest backups, newest first',
  'regie.server.backup.listCopy': 'Copy the restore command for {name}',
  'regie.server.backup.listRestore':
    'Restoring replaces the database and needs the stack stopped, so it is a command on the server. Copy it from a row above, or use this one with the name of the backup:',
  'regie.server.backup.listRestoreCopy': 'Copy command',
} as const satisfies Namespace<'regie.server'>;
