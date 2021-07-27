import ContainerController from '../../cardinal/controllers/base-controllers/ContainerController.js';
import utils from "../../utils.js";
import constants from "../../constants.js";
import DSUDataRetrievalService from "../services/DSUDataRetrievalService/DSUDataRetrievalService.js";

const gtinResolver = require("gtin-resolver");

export default class WKScanController extends ContainerController {
    constructor(element, history) {
        super(element, history);

        this.setModel({data: '', hasCode: false, hasError: false, nativeSupport: false, useScandit: false});
 
        let resolutions = [ 
            {label: "hd1280x720", value: "1280"},
            {label: "hd1920x1080", value: "1920"},
            {label: "hd4K3840x2160", value: "3840"},
            {label: "iFrame960x540", value: "960"},
            {label: "vga640x480", value: "640"},
            {label: "cif352x288", value: "352"} 
        ];
       
        this.model.cameraResolution = {
            placeholder: "Camera resolution",
            options: resolutions
        } 
        this.model.WKCameraImage = null;

        const popStateHandler = (event) => { 
            this.callNative("StopCamera");
            window.removeEventListener('popstate', popStateHandler);
        }
        window.addEventListener('popstate', popStateHandler);
 
    
        this.on("camera-start", (event) => { 
            console.log("camera-start");
            
            var sessionPreset="vga640x480";
            var flashMode = "off";
            var onFramePreviewCallback = undefined;
            var targetPreviewFps = 25; 
            var previewWidth = 640;
            var onFrameGrabbedCallBack = undefined;
            var  targetGrabFps = 10;

                _targetPreviewFps = targetPreviewFps;
                _previewWidth = previewWidth;
                _onFramePreviewCallback = onFramePreviewCallback;
                _onFrameGrabbedCallBack = onFrameGrabbedCallBack;
                _targetGrabFps = targetGrabFps
            var params = {
                    "onInitializedJsCallback": onNativeCameraInitialized.name,
                    "sessionPreset": sessionPreset.name,
                    "flashMode": flashMode,
                    "previewWidth": _previewWidth
                }
                callNative("StartCamera", params);
        });

        this.on("camera-stop", (event) => { 
            console.log("camera-stop");
            this.callNative("StopCamera");
        });
        this.on("camera-picture", (event) => { 
            takePictureNativeCamera(this.onPictureTaken)
        });
        this.on("camera-flash", (event) => { 
            console.log("camera-flash");
        });

  
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
        callNative("TakePicture", {"onCaptureJsCallback": onCaptureCallback.name});
    }
 
     onPictureTaken(base64ImageData) {
        console.log(`Inside onPictureTaken`)
        this.model.WKCameraImage = base64ImageData
    }
 
}
