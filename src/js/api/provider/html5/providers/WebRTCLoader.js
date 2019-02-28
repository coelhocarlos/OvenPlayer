import adapter from 'utils/adapter';
import _ from "utils/underscore";
import {
    ERRORS,
    PLAYER_WEBRTC_WS_ERROR,
    PLAYER_WEBRTC_WS_CLOSED,
    PLAYER_WEBRTC_ADD_ICECANDIDATE_ERROR,
    PLAYER_WEBRTC_SET_REMOTE_DESC_ERROR,
    PLAYER_WEBRTC_CREATE_ANSWER_ERROR,
    PLAYER_WEBRTC_SET_LOCAL_DESC_ERROR,
    PLAYER_WEBRTC_NETWORK_SLOW,
    NETWORK_UNSTABLED
} from "api/constants";


const WebRTCLoader = function(provider, url, errorTrigger){
    var url = url;
    let ws = "";
    let peerConnection = "";
    let statisticsTimer = "";
    const config = {
        'iceServers': [
            {
                urls: 'turn:numb.viagenie.ca',
                credential: 'muazkh',
                username: 'webrtc@live.com'
            },
            {
                urls: 'turn:192.158.29.39:3478?transport=udp',
                credential: 'JZEOEt2V3Qb0y27GRntt2u2PAYA=',
                username: '28224511:1379330808'
            },
            {
                urls: 'turn:192.158.29.39:3478?transport=tcp',
                credential: 'JZEOEt2V3Qb0y27GRntt2u2PAYA=',
                username: '28224511:1379330808'
            },
            {
                urls: 'turn:turn.bistri.com:80',
                credential: 'homeo',
                username: 'homeo'
            },
            {
                urls: 'turn:turn.anyfirewall.com:443?transport=tcp',
                credential: 'webrtc',
                username: 'webrtc'
            },{
            'urls': 'stun:stun.l.google.com:19302'
        }]
    };
    const that = {};
    let answerSdp = "", offerSdp = "";


    (function() {
        var existingHandler = window.onbeforeunload;
        window.onbeforeunload = function(event) {
            if (existingHandler){
                existingHandler(event);
            };
            OvenPlayerConsole.log("This calls auto when browser closed.");
            closePeer();
        }
    })();


    function initialize() {
        OvenPlayerConsole.log("WebRTCLoader connecting...");

        const onLocalDescription = function(id, connection, desc) {
            connection.setLocalDescription(desc).then(function (){
                // my SDP created.
                var localSDP = connection.localDescription;
                OvenPlayerConsole.log('Local SDP', localSDP);
                answerSdp = localSDP;   //test code
                // my sdp send to server.
                ws.send(JSON.stringify({
                    id: id,
                    command : "answer",
                    sdp: localSDP
                }));
            }).catch(function(error){
                let tempError = ERRORS[PLAYER_WEBRTC_SET_LOCAL_DESC_ERROR];
                tempError.error = error;
                closePeer(tempError);
            });
        };

        return new Promise(function(resolve, reject){
            OvenPlayerConsole.log("WebRTCLoader url : " + url);
            try {
                ws = new WebSocket(url);
                ws.onopen = function() {
                    ws.send(JSON.stringify({command : "request_offer"}));
                };
                ws.onmessage = function(e) {
                    const message = JSON.parse(e.data);
                    if(message.error){
                        let tempError = ERRORS[PLAYER_WEBRTC_WS_ERROR];
                        tempError.error = message.error;
                        closePeer(tempError);
                        return false;
                    }
                    if(message.list) {
                        OvenPlayerConsole.log('List received');
                        return;
                    }

                    if(!message.id) {
                        OvenPlayerConsole.log('ID must be not null');
                        return;
                    }

                    if(!peerConnection){
                        peerConnection = new RTCPeerConnection(config);

                        peerConnection.onicecandidate = function(e) {
                            if(e.candidate){
                                OvenPlayerConsole.log("WebRTCLoader send candidate to server : " + e.candidate);
                                ws.send(JSON.stringify({
                                    id: message.id,
                                    command : "candidate",
                                    candidates: [e.candidate]
                                }));
                            }
                        };

                        peerConnection.oniceconnectionstatechange = function(event) {
                            console.log(peerConnection.iceConnectionState);
                            provider.trigger("oniceconnectionstatechange", {
                                state : peerConnection.iceConnectionState,
                                answerSdp : answerSdp,
                                offerSdp : offerSdp
                            });
                        };


                        peerConnection.onnegotiationneeded = function() {
                            peerConnection.createOffer().then(function(desc) {
                                OvenPlayerConsole.log("createOffer : success")
                                onLocalDescription(message.id, peerConnection, desc);
                            }).catch(function(error){
                                let tempError = ERRORS[PLAYER_WEBRTC_CREATE_ANSWER_ERROR];
                                tempError.error = error;
                                closePeer(tempError);
                            });
                        };

                        peerConnection.onaddstream = function(e) {
                            OvenPlayerConsole.log("stream received.");
                            // stream received.
                            let lostPacketsArr = [],
                                slotLength = 8, //8 statistics. every 2 seconds
                                prevPacketsLost = 0,
                                avg8Losses = 0,
                                avgMoreThanThresholdCount = 0,  //If avg8Loss more than threshold.
                                threshold = 20;
                            const extractLossPacketsOnNetworkStatus = function(){
                                statisticsTimer = setTimeout(function(){
                                    if(!peerConnection){
                                        return false;
                                    }
                                    peerConnection.getStats().then(function(stats) {
                                        stats.forEach(function(state){
                                            if(state.type === "inbound-rtp" && !state.isRemote ){
                                                OvenPlayerConsole.log(state);

                                                //(state.packetsLost - prevPacketsLost) is real current lost.
                                                lostPacketsArr.push(parseInt(state.packetsLost)-parseInt(prevPacketsLost));

                                                if(lostPacketsArr.length > slotLength){
                                                    lostPacketsArr = lostPacketsArr.slice(lostPacketsArr.length - slotLength, lostPacketsArr.length);
                                                    avg8Losses = _.reduce(lostPacketsArr, function(memo, num){ return memo + num; }, 0) / slotLength;
                                                    OvenPlayerConsole.log("Last8 LOST PACKET AVG  : "+ (avg8Losses), state.packetsLost , lostPacketsArr);
                                                    if(avg8Losses > threshold){
                                                        avgMoreThanThresholdCount ++;
                                                        if(avgMoreThanThresholdCount === 3){
                                                            OvenPlayerConsole.log("NETWORK UNSTABLED!!! ");
                                                            clearTimeout(statisticsTimer);
                                                            provider.trigger(NETWORK_UNSTABLED);
                                                        }
                                                    }else{
                                                        avgMoreThanThresholdCount = 0;
                                                    }

                                                }

                                                prevPacketsLost = state.packetsLost;
                                            }
                                        });



                                        extractLossPacketsOnNetworkStatus();
                                    })

                                }, 2000);

                            };
                            extractLossPacketsOnNetworkStatus();
                            resolve(e.stream);
                        };
                    }

                    if(message.sdp) {
                        //Set remote description when I received sdp from server.
                        peerConnection.setRemoteDescription(new RTCSessionDescription(message.sdp)).then(function(){
                            if(peerConnection.remoteDescription.type === 'offer') {
                                // This creates answer when I received offer from publisher.
                                offerSdp = peerConnection.remoteDescription.sdp;
                                peerConnection.createAnswer().then(function(desc){
                                    OvenPlayerConsole.log("createAnswer : success");
                                    onLocalDescription(message.id, peerConnection, desc);
                                }).catch(function(error){
                                    let tempError = ERRORS[PLAYER_WEBRTC_CREATE_ANSWER_ERROR];
                                    tempError.error = error;
                                    closePeer(tempError);
                                });
                            }
                        }).catch(function(error){
                            let tempError = ERRORS[PLAYER_WEBRTC_SET_REMOTE_DESC_ERROR];
                            tempError.error = error;
                            closePeer(tempError);
                        });
                    }

                    if(message.candidates) {
                        // This receives ICE Candidate from server.
                        for(let i = 0; i < message.candidates.length; i ++ ){
                            if(message.candidates[i] && message.candidates[i].candidate) {

                                peerConnection.addIceCandidate(new RTCIceCandidate(message.candidates[i])).then(function(){
                                    OvenPlayerConsole.log("addIceCandidate : success");
                                }).catch(function(error){
                                    let tempError = ERRORS[PLAYER_WEBRTC_ADD_ICECANDIDATE_ERROR];
                                    tempError.error = error;
                                    closePeer(tempError);
                                });
                            }
                        }
                    }

                };
                ws.onerror = function(error) {
                    let tempError = ERRORS[PLAYER_WEBRTC_WS_ERROR];
                    tempError.error = error;
                    closePeer(tempError);
                    reject(error);
                };
            }catch(error){
                closePeer(error);
            }
        });
    }

    function closePeer(error) {
        OvenPlayerConsole.log('WebRTC Loader closePeear()');
        if(ws) {
            OvenPlayerConsole.log('Closing websocket connection...');
            OvenPlayerConsole.log("Send Signaling : Stop.");
            /*
            0 (CONNECTING)
            1 (OPEN)
            2 (CLOSING)
            3 (CLOSED)
            */
            if(ws.readyState == 1){
                ws.send(JSON.stringify({command : "stop"}));
                ws.close();
            }
            ws = null;
        }
        if(peerConnection) {
            OvenPlayerConsole.log('Closing peer connection...');
            if(statisticsTimer){clearTimeout(statisticsTimer);}
            peerConnection.close();
            peerConnection = null;
        }
        if(error){
            errorTrigger(error, provider);
        }
    }


    that.connect = () => {
        return initialize();
    };
    that.destroy = () => {
        peerConnection.log("WEBRTC LOADER destroy");
        closePeer();
    };
    return that;
};

export default WebRTCLoader;
