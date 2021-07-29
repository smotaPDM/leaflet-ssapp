import ContainerController from '../../cardinal/controllers/base-controllers/ContainerController.js';
import utils from "../../utils.js";
import constants from "../../constants.js";
import DSUDataRetrievalService from "../services/DSUDataRetrievalService/DSUDataRetrievalService.js";

const gtinResolver = require("gtin-resolver");


const _targetPreviewFps = 20;
const _targetGrabFps = 10;

var _previewHandle = undefined;
var _grabHandle = undefined;
var _serverUrl = undefined;

var _onFramePreviewCallback = undefined;
var _onFrameGrabbedCallBack = undefined;

export default class WKScanController extends ContainerController {
    constructor(element, history) {
        super(element, history);

        this.setModel({ data: '', hasCode: false, hasError: false, nativeSupport: false, useScandit: false });


        let resolutions = [
            { label: "hd1280x720", value: "1280" },
            { label: "hd1920x1080", value: "1920" },
            { label: "hd4K3840x2160", value: "3840" },
            { label: "iFrame960x540", value: "960" },
            { label: "vga640x480", value: "640" },
            { label: "cif352x288", value: "352" }
        ];
        var flashMode = "auto";

        this.model.cameraResolution = {
            placeholder: "Camera resolution",
            options: resolutions
        }
        this.model.wkCameraImage = undefined;
        this.model.wkTempMessage = "";
        this.model.status_fps_preview = "";
        this.model._serverUrl = undefined;

        const popStateHandler = (event) => {
            this.callNative("StopCamera");
            window.removeEventListener('popstate', popStateHandler);
        }
        window.addEventListener('popstate', popStateHandler);

        this.model.onChange("data", () => {
            this.model.wkTempMessage = "this.model.onChange";
        });

        this.element.model = this.model;
        this.element.onNativeCameraInitialized = this.onNativeCameraInitialized;
        this.element.onPictureTaken = this.onPictureTaken;

        if (window != undefined) {
            window.model = this.model;
            window.onNativeCameraInitialized = this.onNativeCameraInitialized;
            window.onPictureTaken = this.onPictureTaken;
        } else {
            console.log("window is undefined");
        }


        _onFramePreviewCallback = this.onFramePreview;
        _onFrameGrabbedCallBack = this.onFrameGrabbed;

        this.on("camera-start", (event) => {
            this.model.wkTempMessage = "camera-start";
            console.log("camera-start");

            var sessionPreset = "vga640x480";

            //var targetPreviewFps = 25; 
            var previewWidth = 640;
            //var onFrameGrabbedCallBack = undefined;
            //var  targetGrabFps = 10;


            var params = {
                "onInitializedJsCallback": "onNativeCameraInitialized",
                "sessionPreset": sessionPreset,
                "flashMode": flashMode,
                "previewWidth": previewWidth
            };
            this.callNative("StartCamera", params);
            /*
                        this.getNativeApiHandler((err, handler) => {
                            if (err) {
                                console.log("Not able to activate native API support. Continue using bar code scanner from web.", err);
                            }
                            else if (handler) {
                                this.model.nativeSupport = true; 
                                this.model.wkTempMessage = "handler - camera-nativeOperation";
                                const nativeOperation = handler.importNativeAPI("WKStartCamera");
                
                                nativeOperation().then((resultArray) => {
                                    this.model.wkTempMessage = "camera-nativeOperation OK";
                                    if (resultArray && resultArray.length > 0) {
                                        console.log(resultArray);
                                        this.model.wkTempMessage = "camera-resultArray" + resultArray;
                                    }
                                }, (error) => {
                                    this.redirectToError("operation failded");
                                    this.model.wkTempMessage = "camera-nativeOperation ERROR";
                                  
                                }).catch((err) => {
                                    this.model.wkTempMessage = "camera-nativeOperation catch";
                                    this.redirectToError("Code scanning and processing finished with errors.");
                                });
                            }  
                        });*/

        });

        this.on("camera-stop", (event) => {
            this.model.wkTempMessage = "camera-stop";
            this.callNative("StopCamera");
        });
        this.on("camera-picture", (event) => {
            this.model.wkTempMessage = "camera-picture";
            this.takePictureNativeCamera("onPictureTaken")
        });
        this.on("camera-flash", (event) => {
            this.model.wkTempMessage = "camera-flash";
            this.callNative("SetFlashMode", { "mode": flashMode })
        });

        this.model.wkTempMessage = "WKScanController construtor";
    }



    callNative(api, args, callback) {
        let handle = window.webkit.messageHandlers[api];
        let payload = {};
        if (args !== undefined) {
            payload["args"] = args;
        }
        if (callback !== undefined) {
            payload["callback"] = callback.name;
        }
        handle.postMessage(payload);
    }

    takePictureNativeCamera(onCaptureCallback) {
        this.model.wkTempMessage = "takePictureNativeCamera";
        this.callNative("TakePicture", { "onCaptureJsCallback": onCaptureCallback });
    }

    onPictureTaken(base64ImageData) {
        console.log(`Inside onPictureTaken`)
        this.model.wkCameraImage = base64ImageData
    }

    onNativeCameraInitialized(wsPort) {
        this.model.wkTempMessage = "onNativeCameraInitialized" + wsPort;

        _serverUrl = `http://localhost:${wsPort}`
        if (_onFramePreviewCallback !== undefined) {
            _previewHandle = setInterval(() => {
                let t0 = performance.now();
                getPreviewFrame().then(a => {
                    if (a.byteLength > 1) {
                        _onFramePreviewCallback(a, performance.now() - t0)
                    }
                });
            }, 1000 / _targetPreviewFps);
        }
        if (_onFrameGrabbedCallBack !== undefined) {
            _grabHandle = setInterval(() => {
                let t0 = performance.now();
                getRawFrame().then(a => {
                    if (a.byteLength > 1) {
                        _onFrameGrabbedCallBack(a, performance.now() - t0);
                    }
                })
            }, 1000 / _targetGrabFps)
        }
    }

    getPreviewFrame() {
        this.model.status_fps_preview = "getPreviewFrame start" ;
        return fetch(`${_serverUrl}/previewframe`)
            .then(response => {
                return response.blob().then(b => {
                    return b.arrayBuffer().then(a => {
                        return a;
                    })
                })
            })
            .catch(error => {
                console.log(error);
                this.model.status_fps_preview = "getPreviewFrame " + error;
            })
    }

    getRawFrame() {
        this.model.status_fps_preview = "getRawFrame start" ;
        return fetch(`${_serverUrl}/rawframe`)
            .then(response => {
                return response.blob().then(b => {
                    return b.arrayBuffer().then(a => {
                        return a;
                    })
                })
            })
            .catch(error => {
                console.log(error);
                this.model.status_fps_preview = "getRawFrame " + error;
            })
    }


    getNativeApiHandler(callback) {
        try {
            const nativeBridgeSupport = window.opendsu_native_apis;
            if (typeof nativeBridgeSupport === "object") {
                return nativeBridgeSupport.createNativeBridge(callback);
            }

            callback(undefined, undefined);
        } catch (err) {
            console.log("Caught an error during initialization of the native API bridge", err);
        }
    }


    /**
     * @param {ArrayBuffer} buffer preview data coming from native camera. Can be used to create a new Uint8Array
     * @param {number} elapsedTime time in ms elapsed to get the preview frame
     */
    onFramePreview(buffer, elapsedTime) {
        this.model.status_fps_preview = "onFramePreview";
        /*
        var frame = new Uint8Array(buffer);
        material.map = new THREE.DataTexture(frame, previewWidth, previewHeight, formatTexture, THREE.UnsignedByteType);
        material.map.flipY = true;
        material.needsUpdate = true;

        if (previewFramesCounter !== 0 && previewFramesCounter % (fpsMeasurementInterval - 1) === 0) {
            previewFramesMeasuredFPS = 1000 / previewFramesElapsedSum * fpsMeasurementInterval;
            previewFramesCounter = 0;
            previewFramesElapsedSum = 0;
        } else {
            previewFramesCounter += 1;
            previewFramesElapsedSum += elapsedTime;
        }
        this.model.status_fps_preview  = `preview ${Math.round(elapsedTime)} ms (max FPS=${Math.round(previewFramesMeasuredFPS)})`
        */
    }

    /**
     * @param {ArrayBuffer} buffer raw data coming from native camera. Can be used to create a new Uint8Array
     * @param {number} elapsedTime time in ms elapsed to get the raw frame
     */

    onFrameGrabbed(buffer, elapsedTime) {
        this.model.status_fps_preview = "onFrameGrabbed";
        /*
        var rawframe = new Uint8Array(buffer);
        status_test.innerHTML = `${sessionPreset.name}, p(${previewWidth}x${previewHeight}), p FPS:${targetPreviewFPS}, raw FPS:${targetRawFPS}<br/> raw frame length: ${Math.round(10 * rawframe.byteLength / 1024 / 1024) / 10}MB, [0]=${rawframe[0]}, [1]=${rawframe[1]}`

        if (rawFramesCounter !== 0 && rawFramesCounter % (fpsMeasurementInterval - 1) === 0) {
            rawFramesMeasuredFPS = 1000 / rawFramesElapsedSum * fpsMeasurementInterval;
            rawFramesCounter = 0;
            rawFramesElapsedSum = 0;
        } else {
            rawFramesCounter += 1;
            rawFramesElapsedSum += elapsedTime;
        }
        status_fps_raw.innerHTML = `raw ${Math.round(elapsedTime)} ms (max FPS=${Math.round(rawFramesMeasuredFPS)})`
        */
    }


}
