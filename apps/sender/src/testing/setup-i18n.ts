import { resetLocaleForTests } from '@studioflow/i18n';

// Unit tests run in English; a test that asserts German calls `resetLocaleForTests('de-CH')` itself.
beforeEach(() => resetLocaleForTests('en'));
