/* Copyright 2018 Google LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License. */

let hls = new Hls();
// The video element.
let videoElement;
// Used to store media ids and timestamps for verification processing.
let mediaIdsQueue = [];
// URL used for media verification.
let verificationUrl;
// Array of Ad break objects.
let adBreaks = [];

/**
 * initPlayer is the entry point into the code.
 */
function initPlayer() {
  const API_URL_BASE = 'https://dai.google.com/ondemand/v1/hls/content/';
  const CMSID = '2528370';
  const VID = 'tears-of-steel';
  let request = new XMLHttpRequest();
  let apiUrl =  API_URL_BASE + CMSID + '/vid/' + VID + '/stream';

  // Make initial API request to create a DAI stream.
  request.open('POST', apiUrl, true);
  request.onreadystatechange = () => {
    // Server should respond with HTTP/1.1 201 Created,
    if(request.readyState === XMLHttpRequest.DONE) {
      if (request.status === 201) {
        onStreamCreated(request.responseText);
      } else {
        console.log("BAD response: " + request.responseText);
      }
    }
  };
  console.log("sending stream request");
  request.send();
}

/**
 * onStreamCreated is called when a stream create request response is received.
 * @param  {string} responseText HTTP responseText in JSON format.
 */
function onStreamCreated(responseText) {
  let json = JSON.parse(responseText);
  let mainPlaylist = json.hls_master_playlist;
  verificationUrl = json.media_verification_url;
  if (!mainPlaylist) {
    console.error("HLS playlist not found!");
    return;
  } else if (!verificationUrl) {
    console.error("Verification URL not found!");
    return;
  }

  // Parse metadata to extract the media identifier used for verification.
  hls.on(Hls.Events.FRAG_PARSING_METADATA, parseMetadata);

  videoElement = document.getElementById('video');

  adBreaks = json.ad_breaks;

  // Set up video container click listener for clickthrough.
  let videoContainer = document.getElementById('videoContainer');
  videoContainer.addEventListener('click', () => {
    let currentAd = getCurrentAd();
    if (currentAd != null) {
      console.log('Ad clicked: ' + currentAd.clickthrough_url);
      window.open(currentAd.clickthrough_url, "_blank");
    } else {
      console.log('No current ad break!');
    }
  });

  // Load and play the playlist.
  hls.loadSource(mainPlaylist);
  hls.attachMedia(videoElement);
  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    console.log('Video Play');
    videoElement.play();
    videoElement.controls = true;
  });

  setInterval(checkVerifyMedia, 500);
  setInterval(updateControls, 500);
}

/**
 * updateControls hides the controls during ad breaks, shows them otherwise.
 */
function updateControls() {
  videoElement.controls = (getCurrentAdBreak() == null);
}

/**
 * getCurrentAdBreak returns the current ad break or null if the video is not
 * in an ad break.
 * @return {Object?} the ad break object or null.
 */
function getCurrentAdBreak() {
  let currentAdBreak = null;
  adBreaks.forEach((adBreak) => {
    if (videoElement.currentTime >= adBreak.start &&
      videoElement.currentTime < adBreak.start + adBreak.duration) {
      return currentAdBreak = adBreak;
    }
  });
  return currentAdBreak;
}

/**
 * getCurrentAd returns the current ad object or null if the video is not
 * in an ad break.
 * @return {Object?} the ad object or null.
 */
function getCurrentAd() {
  // Iterate through ad breaks to find current break.
  let currentAd = null;
  let currentAdBreak = getCurrentAdBreak();
  if (currentAdBreak == null) { // Not in an ad break.
    return null;
  } else {
    // Sort by ad sequence number.
    currentAdBreak.ads.sort((a, b) => {
      return a.seq - b.seq;
    });
    // Iterate through ads to find current ad.
    let adTime = currentAdBreak.start;
    currentAdBreak.ads.forEach((ad) => {
      adTime += ad.duration;
      if (videoElement.currentTime < adTime) {
        return currentAd = ad;
      }
    });
  }

  return currentAd;
}

/**
 * parseMetadata parses metadata to extract a media identifier for verification.
 * @param  {Event} event the event object.
 * @param  {Object} data metadata passed in by the event handler.
 */
function parseMetadata(event, data) {
  if (data) {
    // For each ID3 tag in our metadata, we pass in the type - ID3, the
    // tag data (a byte array), and the presentation timestamp (PTS).
    data.samples.forEach((sample) => {
      var sampleString = new TextDecoder("utf-8").decode(sample.data);
      var mediaId = sampleString.slice(
          sampleString.indexOf("google_"), sampleString.length);

      // Keep track of mediaIds and timestamps in a queue.
      mediaIdsQueue.push({mediaId: mediaId, timestamp: sample.pts});
    });
  }
}

/**
 * checkVerifyMedia is called to check if we have a media id whose timestamp has
 * passed. If so, open up an HTTP request to the verification URL.
 */
function checkVerifyMedia() {
  if (mediaIdsQueue.length > 0 &&
    mediaIdsQueue[0].timestamp <= videoElement.currentTime) {
    var mediaId = mediaIdsQueue.shift().mediaId;
    var request = new XMLHttpRequest();

    request.open('GET', verificationUrl + mediaId, true);
    request.onreadystatechange = () => {
      switch(request.status) {
        case 204: // Normal response for verification success, do nothing.
          break;
        case 404: // Incorrect verification URL.
          console.error("Media verification not found, wrong media id?");
          break;
        default: // We shouldn't be getting any other status codes.
          console.error("Unknown status code from media verification: " +
            request.status);
          break;
      }
    };
    request.send();
  }
}