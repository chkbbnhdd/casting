export const environment = {
  production: false,
  receiver: {
    castReceiverScriptUrl: 'https://www.gstatic.com/cast/sdk/libs/caf_receiver/v3/cast_receiver_framework.js',
    debugEventThrottleMs: 500,
    showDebugOverlay: true,
    configEndpointUrl: 'https://test95-cdn.dr-massive.com/api/config?device=chromecast&ff=idp%2Cldp%2Crpt&include=classification%2Csubscription%2Csitemap%2Cnavigation%2Cgeneral%2Ci18n%2Cplayback%2Clinear%2CfeatureFlags&lang=da&segments=drtv&sub=Registered',
    pageEndpointBaseUrl: 'https://test95-cdn.dr-massive.com/api/page',
    videoEndpointBaseUrl: 'https://test95.dr-massive.com/api/account/items',
    videoEndpointDevice: 'chromecast',
    customNamespace: 'urn:x-cast:dk.dr.tv.chromecast',
    skipTimeCodeType: 'Intro',
  },
};
