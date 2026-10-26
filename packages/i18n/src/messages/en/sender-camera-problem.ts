import type { Namespace } from '../../types';

/**
 * What the station tells the person when the camera fails: a title per kind of problem and the steps to fix it, which
 * depend on the browser (the permission dialogs differ). The names of buttons and settings follow the browsers.
 */
export const senderCameraProblem = {
  'sender.camera.problem.androidChromeStep1':
    'Tap the icon with the sliders to the left of the address, then “Permissions”.',
  'sender.camera.problem.androidChromeStep2': 'Set the camera to “Allow”.',
  'sender.camera.problem.androidChromeStep3': 'Reload the page.',
  'sender.camera.problem.androidOtherStep1':
    'In the site settings of the browser, allow the camera for this page.',
  'sender.camera.problem.androidOtherStep2':
    'Check that the browser may use the camera in the Android settings.',
  'sender.camera.problem.androidOtherStep3': 'Reload the page.',
  'sender.camera.problem.busyStep1':
    'Close the other app, for example Camera, Teams, Zoom or another browser tab.',
  'sender.camera.problem.busyTitle': 'The camera is being used by another app',
  'sender.camera.problem.deniedTitle': 'No access to the camera',
  'sender.camera.problem.desktopChromiumStep1':
    'Click the icon with the sliders to the left of the address.',
  'sender.camera.problem.desktopChromiumStep2': 'Set the camera to “Allow”.',
  'sender.camera.problem.desktopChromiumStep3':
    'Reload the page. On Windows and macOS the browser must be allowed to use the camera in the system settings.',
  'sender.camera.problem.firefoxStep1': 'Click the crossed-out camera icon in the address bar.',
  'sender.camera.problem.firefoxStep2': 'Remove the block for the camera.',
  'sender.camera.problem.firefoxStep3': 'Reload the page.',
  'sender.camera.problem.iosStep1':
    'In Safari, tap “aA” on the left of the address bar, then “Website Settings”.',
  'sender.camera.problem.iosStep2': 'Next to “Camera”, choose “Allow”.',
  'sender.camera.problem.iosStep3':
    'Reload the page. If that does not help: Settings > Apps > Safari > Camera > “Allow”.',
  'sender.camera.problem.lostStep1': 'Perhaps a call or another app has taken over the camera.',
  'sender.camera.problem.lostTitle': 'The camera no longer delivers a picture',
  'sender.camera.problem.macosSafariStep1':
    'In the “Safari” menu, open “Settings for This Website”.',
  'sender.camera.problem.macosSafariStep2': 'Next to “Camera”, choose “Allow”.',
  'sender.camera.problem.macosSafariStep3':
    'Reload the page. Safari must be allowed in System Settings > Privacy & Security > Camera.',
  'sender.camera.problem.missingStep1': 'Check that a camera is connected and switched on.',
  'sender.camera.problem.missingTitle': 'No camera found',
  'sender.camera.problem.otherStep1':
    'In the settings of the browser, allow the camera for this page.',
  'sender.camera.problem.otherStep2': 'Reload the page.',
  'sender.camera.problem.otherTitle': 'The camera could not be started',
  'sender.camera.problem.publishStep1': 'Check the Wi-Fi.',
  'sender.camera.problem.publishTitle': 'The picture could not be sent',
  'sender.camera.problem.retryClick': 'Then click “Try again”.',
  'sender.camera.problem.retryTap': 'Then tap “Try again”.',
} as const satisfies Namespace<'sender.camera.problem'>;
