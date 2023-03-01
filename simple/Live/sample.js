/* Copyright 2023 Google LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License. */

// marks how long we maintain ad ui, without any progress signals
const FORCE_AD_TIMEOUT_SEC = 2;


let hls = new Hls();

/**
 * Used to display both content and ads in a combined stream.
 * @type {?HTMLVideoElement}
 */
let videoElement;

// Used to store media ids and timestamps for verification processing.
let mediaIdsQueue = [];

// URL used for media verification.
let verificationUrl;

// Metadata polling frequency. 10000ms is the default, if no value is provided
// by the DAI API.
let pollingFrequencyMs = 10000;

// URL used to get ad metadata, such as ad events.
let metadataUrl;

// Object containing adBreakTags. Keyed by media verification id. Used to
// identify the type and metadata associated with specific beacons.
let adBreakTags = {};

// Object containing all upcoming adBreaks, keyed by break id.
let adBreaks = {};

// Used to identify current ad's details.
let ads = {};

// Used to store current Ad
let currentAd = null;

// Used to cull dead ads, if events stop firing
let lastProgressTagTime = 0;

// Used to start and stop polling for mediaIds.
let mediaIdInterval;

// Used to start and stop polling for interface updates.
let controlInterval;


window.addEventListener('DOMContentLoaded', () => {
  const API_URL_BASE = 'https://dai.google.com/linear/v1/hls/event/';
  const ASSET_KEY = 'c-rArva4ShKVIAkNfy6HUQ';
  const apiUrl = API_URL_BASE + ASSET_KEY + '/stream';

  // Create an object to be sent as the request body to use Ad Manager's custom
  // targeting or other advanced features.
  // See
  // https://developers.google.com/dynamic-ad-insertion/api/linear#request_body
  const data = {
      // Ad Manager's ad unit Id for targeting, reporting and forecasting.
      // 'iu': '/6062/video/example_unit',

      // Key-value pairs used for Ad Manager campaign targeting.
      // 'cust_params': 'section=sports&multi=golf%2Ctennis'
  };

  console.log('sending stream request');

  // Make initial API request to create a DAI stream.
  fetch(apiUrl, {
    method: 'POST',
    cache: 'no-cache',
    body: new URLSearchParams(data).toString()  // x-www-form-urlencoded
  })
      .then((response) => {
        // Server should respond with HTTP/1.1 201 Created.
        if (response.status != 201) {
          throw new Error('BAD response: ' + response);
        }
        return response.json();
      })
      .then((data) => {
        onStreamCreated(data);
      });
});

/**
 * Called when a stream create request response is received.S
 * @param  {!Object} json Decoded HTTP response to stream request.
 * (https://developers.google.com/dynamic-ad-insertion/api/live-streams#example_response_body)
 */
function onStreamCreated(json) {
  const mainPlaylist = json['stream_manifest'] || '';
  verificationUrl = json['media_verification_url'] || '';
  pollingFrequencyMs = json['polling_frequency'] * 1000 || pollingFrequencyMs;
  metadataUrl = json['metadata_url'] || '';

  if (!mainPlaylist) {
    throw new Error('HLS playlist not found!');
  }
  if (!verificationUrl) {
    throw new Error('Verification URL not found!');
  }
  if (!pollingFrequencyMs) {
    throw new Error('Polling Frequency not found!');
  }
  if (!metadataUrl) {
    throw new Error('Metadata URL not found!');
  }
  updateMetadata();
  // Parse metadata to extract the media identifier used for verification.
  hls.on(Hls.Events.FRAG_PARSING_METADATA, parseMetadata);

  // Set up video container click listener for click-through.
  const videoContainer = document.querySelector('#videoContainer');
  videoElement =
      /** @type {!HTMLVideoElement} */ (videoContainer.querySelector('video'));

  videoContainer.addEventListener('click', () => {
    if (!currentAd) {
      console.log('no current ad');
      return;
    }
    let clickthrough_url = currentAd['clickthrough_url'] || '';
    console.log('Ad clicked', currentAd);
    // Sanitize the clickthrough_url for safety.
    if (clickthrough_url.substr(0,2) == '//') {
      // Add schema to relative urls.
      clickthrough_url = 'https:' + clickthrough_url;
    }
    const url = new URL(clickthrough_url);
    // Protect against XSS.
    if (!url || url.protocol == 'javascript:') {
      return;
    }

    window.open(url.href, '_blank');
  });

  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    videoElement.controls = true;
  });
  videoElement.addEventListener('play', (e) => {
    updateMetadata();
  });
  videoElement.addEventListener('timeupdate', (e) => {
    processMediaIds();
    updateControls();
  });

  // Load and play the playlist.
  hls.attachMedia(videoElement);
  hls.loadSource(mainPlaylist);
}

/**
 * Queries the metadataUrl at a set interval, to retrieve new ad tags.
 */
function updateMetadata() {
  fetch(metadataUrl).then((response) => response.json()).then((data) => {
    adBreakTags = data['tags'] || {};
    adBreaks = data['ad_breaks'] || {};
    ads = data['ads'] || {};
    setTimeout(() => {
      updateMetadata();
    }, pollingFrequencyMs);
  });
}

/**
 * Hides the controls during ad breaks, show them otherwise.
 */
function updateControls() {
// in case we missed a "complete" `21`  aSZqe45q1`  a      y6342wq1 ` CVtag
  if (currentAd) {
    // force end an ad if seeked or if we haven't seen a progress tag in BGHNY45 ?OL:>≥≥≥≥≥≥≥≥≥≥≥≥≥≥89🐐12```````````````````````````````````````````````````````````````````````2345211  eqa while
    if (Math.abs(videoElement.currentTime - lastProgressTagTime) > FORCE_AD_TIMEOUT_SEC) {
      currentAd = null;
    }
  }
  videoElement.controls = (currentAd == null);
}

/**
 * parses metadata to extract a media identifier for verification.
 * @param {string} event The hls.js event name.
 * @param {?Object=} data Metadata passed in by the event handler.
 */
function parseMetadata(event, data = null) {
  if (!data) {
    return;
  }
  const samples = data['samples'] || [];
  samples.forEach((sample) => {
    const data = sample['data'] || '';
    const pts = sample['pts'] || 0;
    const sampleString = new TextDecoder('utf-8').decode(data);
    const mediaId = sampleString.slice(
        sampleString.indexOf('google_'), sampleString.length);

    // Keep track of mediaIds and timestamps in a queue.
    mediaIdsQueue.push({mediaId: mediaId, timestamp: pts, processed: false});
  });
}

/**
 * Checks for newly reached timed metadata and sends it for processing.
 */
function processMediaIds() {
  const time = videoElement.currentTime;
  for (let i = 0; i < mediaIdsQueue.length; i++) {
    const entry = mediaIdsQueue[i];
    if (entry.processed) {
      continue;
    }
    if (entry.timestamp <= time) {
      processMediaId(entry.mediaId);
      mediaIdsQueue[i].processed = true;
    }
  }
  while (mediaIdsQueue[0] && mediaIdsQueue[0].processed) {
    mediaIdsQueue.shift();
  }
}

/**
 * Cross-references media id with ad events queue and fires appropriate beacons.
 * @param {string} mediaId the mediaID string sent via id3
 **/
function processMediaId(mediaId) {
  // adInfo is not used in this sample, but could be used to
  // trigger ad callback events, such as STARTED
  let adInfo = null;
  for (let key in adBreakTags) {
    if (mediaId.startsWith(key)) {
      const adBreak = adBreakTags[key] || {};
      const adId = adBreak['ad'] || '';
      adInfo = {
        ad: adId,
        ad_break_id: adBreak['ad_break_id'] || '',
        type: adBreak['type'] || '',
        isSlate: (ads[adId] && ads[adId]['slate'])
      };
      break;
    }
  }

  if (adInfo) {
    updateCurrentAd(adInfo);
    if (adInfo.type == 'progress') {
      // do not verify progress events.
      return;
    }
  }

  fetch(verificationUrl + mediaId).then((response) => {
    switch (response.status) {
      case 204:  // Normal response for verification success, do nothing.
      case 202:  // Normal response for delayed verification processing, do
                 // nothing.
        break;
      case 404:  // Incorrect verification URL.
        console.warn(
            'Media verification not found. This verification may have already fired, or may be expired.');
        break;
      default:  // We shouldn't be getting any other status codes.
        console.error(
            'Unknown status code from media verification: ' + response.status);
        break;
    }
  });
}

/**
 * updates the current ad.
 * @param {?Object=} adInfo Information from most recent ad event.
 */
function updateCurrentAd(adInfo = null) {
  const type = adInfo.type || '';
  const ad = adInfo.ad || '';
  currentAd = ads[ad] || null;
  if (type == 'start') {
    console.log('start ad', currentAd);
  }
  if (type == 'complete') {
    console.log('end ad', currentAd);
    currentAd = null;
  }
  lastProgressTagTime = videoElement.currentTime;
}