/** A form of the settings page "All productions" (at most one is open). */
export type ProductionsForm = 'new' | 'import' | 'duplicate';

/**
 * Query parameter that opens a form when the page is reached from the production switcher (`?form=new`,
 * `?form=import`). A file of its own, so the switcher in the control room does not load the settings page.
 */
export const PRODUCTIONS_FORM_PARAM = 'form';
