/* ==========================================================================
   Settings. This is the only file you need to edit to set the form up.
   ========================================================================== */
window.FF_CONFIG = {
  // Shown in the top bar and the browser tab.
  title: 'Friends & Family',
  subtitle: 'Order requests',

  // Your Google Apps Script web app URL (ends in /exec). See README.md.
  // Leave empty to run in preview mode: everything works, nothing is sent.
  endpoint: '',

  // When true, the page is locked until a valid invite is opened or entered.
  // Invites live in your Google Sheet (menu Friends & Family > Manage invites…),
  // which gives each person a link like https://your-site/#invite=CODE. Nothing
  // secret goes in this file. Leave false while trying things out.
  inviteCodeRequired: false,

  // Two-letter country code to start in. Empty = guess from the browser.
  defaultCountry: '',

  // Limits.
  maxQuantity: 5,         // per item
  maxTradeIns: 3,         // devices per request
  engravingMaxLength: 30,

  // Strings, or { value, regions: ['US', ...] } to show only in some countries.
  contactMethods: [
    'iMessage',
    'WhatsApp',
    'Text message',
    'Email',
    'Phone call',
    { value: 'WeChat', regions: ['CN', 'HK', 'MO', 'TW'] },
    { value: 'LINE', regions: ['JP', 'TW', 'TH'] },
    { value: 'KakaoTalk', regions: ['KR'] },
  ],

  // How people pay you back after approving the final price. Keep 'Other' last.
  paymentMethods: [
    { value: 'Apple Cash', regions: ['US'] },
    { value: 'Venmo', regions: ['US'] },
    { value: 'Zelle', regions: ['US'] },
    { value: 'Interac e-Transfer', regions: ['CA'] },
    'PayPal',
    'Wise',
    'Bank transfer',
    'Cash',
    'Other',
  ],

  // Ask for an optional maximum budget on the review step.
  askBudget: true,

  // Checkboxes people must tick before sending. Edit or remove freely.
  acknowledgements: [
    'I understand nothing is ordered until I approve the final price.',
    'These products are for me or are gifts. They aren’t for resale.',
  ],

  // Optional. If sending fails, offer to email the request to this address.
  fallbackEmail: '',

  // Optional extra line in the footer.
  footerNote: '',
};
