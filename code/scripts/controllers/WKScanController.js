import ContainerController from '../../cardinal/controllers/base-controllers/ContainerController.js';
const gtinResolver = require("gtin-resolver");



/** 
 * If this works it can be copy to nativebridge.js
 * **/

const sessionPresetNames = [
    "low",
    "medium",
    "high",
    "inputPriority",
    "hd1280x720",
    "hd1920x1080",
    "hd4K3840x2160",
    "iFrame960x540",
    "iFrame1280x720",
    "vga640x480",
    "cif352x288",
    "photo"
];

/** Class representing a raw interleaved RGB image */
class PLRgbImage {
    /**
     * create a PLRgbImage
     * @param  {ArrayBuffer} arrayBuffer contains interleaved RGB raw data
     * @param  {Number} width image width 
     * @param  {Number} height image height
     */
    constructor(arrayBuffer, width, height) {
        this.arrayBuffer = arrayBuffer;
        this.width = width;
        this.height = height;
    }
};

var _previewHandle = undefined;
var _grabHandle = undefined;
var _onFramePreviewCallback = undefined;
var _targetPreviewFps = 20;
var _previewWidth = 0;
var _serverUrl = undefined;
var _cameraRunning = false;
var _onFrameGrabbedCallBack = undefined;
var _onCameraInitializedCallBack = undefined;
var _targetGrabFps = 10;
var _x = undefined;
var _y = undefined;
var _w = undefined;
var _h = undefined;

function callNative(api, args, callback) {
    let handle = window.webkit.messageHandlers[api]
    let payload = {}
    if (args !== undefined) {
        payload["args"] = args
    }
    if (callback !== undefined) {
        payload["callback"] = callback.name
    }
    handle.postMessage(payload)
}

function startNativeCamera(sessionPresetName, flashMode, onFramePreviewCallback = undefined, targetPreviewFps = 25, previewWidth = 640, onFrameGrabbedCallBack = undefined, targetGrabFps = 10, auto_orientation_enabled = false, onCameraInitializedCallBack = undefined, x = undefined, y = undefined, w = undefined, h = undefined) {
    _targetPreviewFps = targetPreviewFps
    _previewWidth = previewWidth
    _onFramePreviewCallback = onFramePreviewCallback;
    _onFrameGrabbedCallBack = onFrameGrabbedCallBack;
    _onCameraInitializedCallBack = onCameraInitializedCallBack;
    _targetGrabFps = targetGrabFps
    setRawCropRoi(x, y, w, h);
    let params = {
        "onInitializedJsCallback": onNativeCameraInitialized.name,
        "sessionPreset": sessionPresetName,
        "flashMode": flashMode,
        "previewWidth": _previewWidth,
        "auto_orientation_enabled": auto_orientation_enabled
    }
    callNative("StartCamera", params);
}
/**
 * Sets the raw crop to a new position
 * @param  {number} x
 * @param  {number} y
 * @param  {number} w
 * @param  {number} h
 */
function setRawCropRoi(x, y, w, h) {
    _x = x;
    _y = y;
    _w = w;
    _h = h;
}

/**
 * Stops the native camera
 */
function stopNativeCamera() {
    clearInterval(_previewHandle)
    _previewHandle = undefined
    clearInterval(_grabHandle)
    _grabHandle = undefined
    callNative("StopCamera")
}

/**
 * Takes a photo and return it as base64 string ImageData in callback function
 * @param  {function} onCaptureCallback callback reached when the picture is taken
 */
function takePictureBase64NativeCamera(onCaptureCallback) {

    callNative("TakePicture", { "onCaptureJsCallback": onCaptureCallback.name });
}

/**
 * @returns {Promise<Blob>} gets a JPEG snapshot
 */
function getSnapshot() {
    return fetch(`${_serverUrl}/snapshot`)
        .then(response => {
            return response.blob();
        })
        .catch(error => {
            console.log(error);
        })
}

/**
 * Control camera flash mode
 * @param  {string} mode can be `torch`, `flash`, or `off`, all other values will be treated as `auto`
 */
function setFlashModeNativeCamera(mode) {
    callNative("SetFlashMode", { "mode": mode })
}

function onNativeCameraInitialized(wsPort) {
    _serverUrl = `http://localhost:${wsPort}`
    if (_onFramePreviewCallback !== undefined) {
        _previewHandle = setInterval(() => {
            let t0 = performance.now();
            getPreviewFrame().then(image => {
                if (image instanceof PLRgbImage) {
                    _onFramePreviewCallback(image, performance.now() - t0)
                }
            });
        }, 1000 / _targetPreviewFps);
    }
    if (_onFrameGrabbedCallBack !== undefined) {
        _grabHandle = setInterval(() => {
            let t0 = performance.now();
            getRawFrame(_x, _y, _w, _h).then(image => {
                if (image instanceof PLRgbImage) {
                    _onFrameGrabbedCallBack(image, performance.now() - t0);
                }
            })
        }, 1000 / _targetGrabFps)
    }
    if (_onCameraInitializedCallBack !== undefined) {
        setTimeout(() => {
            _onCameraInitializedCallBack();
        }, 500);
    }
}

/**
 * @returns  {Promise<PLRgbImage>} gets a downsampled RGB frame for preview
 */
function getPreviewFrame() {
    return fetch(`${_serverUrl}/previewframe`)
        .then(response => {
            let image = getPLRgbImageFromResponse(response);
            return image;
        })
        .catch(error => {
            console.log(error);
        })
}

/**
 * Gets a raw RGB frame. A ROI can be specified.
 * @param  {number} x=undefined
 * @param  {number} y=undefined
 * @param  {number} w=undefined
 * @param  {number} h=undefined
 * @returns {Promise<PLRgbImage>} a raw RGB frame
 */
function getRawFrame(x = undefined, y = undefined, w = undefined, h = undefined) {
    let fetchString = `${_serverUrl}/rawframe`;
    let params = {};
    if (x !== undefined) {
        params.x = x;
    }
    if (y !== undefined) {
        params.y = y;
    }
    if (w !== undefined) {
        params.w = w;
    }
    if (h !== undefined) {
        params.h = h;
    }
    if (Object.keys(params).length > 0) {
        const urlParams = new URLSearchParams(params);
        fetchString = `${fetchString}?${urlParams.toString()}`;
    }
    return fetch(fetchString)
        .then(response => {
            let image = getPLRgbImageFromResponse(response);
            return image;
        })
        .catch(error => {
            console.log(error);
        })
}

/**
 * Packs a response from endpoints providing raw rgb buffer as octet-stream and image size in headers
 * 
 * @param  {Response} response
 * @returns {Promise<PLRgbImage>} the image in a promise
 */
function getPLRgbImageFromResponse(response) {
    let frame_w = 0
    let frame_h = 0
    if (response.headers.has("image-width")) {
        frame_w = parseInt(response.headers.get("image-width"));
    }
    if (response.headers.has("image-height")) {
        frame_h = parseInt(response.headers.get("image-height"));
    }
    return response.blob().then(b => {
        return b.arrayBuffer().then(a => {
            let image = new PLRgbImage(a, frame_w, frame_h);
            return image;
        })
    })
}

/** 
 * If this works it can be copy to nativebridge.js
 * **/


export default class WKScanController extends ContainerController {
    constructor(element, history) {
        super(element, history);
        this.setModel({ data: '', hasCode: false, hasError: false, nativeSupport: false, useScandit: false });
        this.model.wkTempMessage = "WKScanController construtor 1";

        if (window != undefined) {
            window.model = this.model;
            //window.onNativeCameraInitialized = this.onNativeCameraInitialized;
            //window.onPictureTaken = this.onPictureTaken;
        } else {
            console.log("window is undefined");
        }

        this.model.renderer = undefined;
        this.model.camera = undefined;
        this.model.scene = undefined;
        this.model.canvasgl = undefined;
        this.model.material = undefined;
        this.model.previewWidth = 360;
        this.model.previewHeight = Math.round(this.model.previewWidth * 16 / 9); // assume 16:9 portrait at start
        this.model.targetPreviewFPS = 25;
        this.model.fpsMeasurementInterval = 5;
        this.model.previewFramesCounter = 0;
        this.model.previewFramesElapsedSum = 0;
        this.model.previewFramesMeasuredFPS = 0;
        this.model.targetRawFPS = 10;
        this.model.rawCrop_x = undefined;
        this.model.rawCrop_y = undefined;
        this.model.rawCrop_w = undefined;
        this.model.rawCrop_h = undefined;
        this.model.rawFramesCounter = 0;
        this.model.rawFramesElapsedSum = 0;
        this.model.rawFramesMeasuredFPS = 0;
        this.model.elapsed = 0
        this.model.controls;
        this.model.formatTexture = THREE.RGBFormat;

        const bytePerChannel = 3;
        if (bytePerChannel === 4) {
            this.model.formatTexture = THREE.RGBAFormat;
        } else if (bytePerChannel === 3) {
            this.model.formatTexture = THREE.RGBFormat;
        }

        this.model.flashMode = 'off'
        this.model.usingMJPEG = false



        this.model.wkTempMessage = "WKScanController construtor 2";

        //document.addEventListener("DOMContentLoaded", () => {


        this.model.status_test = this.element.querySelector('#status_test');
        this.model.status_fps_preview = this.element.querySelector('#status_fps_preview');
        this.model.status_fps_raw = this.element.querySelector('#status_fps_raw');

        this.model.startCameraButtonGL = this.element.querySelector('#startCameraButtonGL');
        this.model.startCameraButtonMJPEG = this.element.querySelector('#startCameraButtonMJPEG');
        this.model.stopCameraButton = this.element.querySelector('#stopCameraButton');
        this.model.stopCameraButton.disabled = true

        this.model.title_h2 = this.element.querySelector('#title_id');
        this.model.takePictureButton1 = this.element.querySelector('#takePictureButton1');
        this.model.takePictureButton2 = this.element.querySelector('#takePictureButton2');
        this.model.flashButton = this.element.querySelector('#flashButton');
        this.model.snapshotImage = this.element.querySelector('#snapshotImage');


        this.model.canvasgl = this.element.querySelector('#cameraCanvas');
        this.model.streamPreview = this.element.querySelector('#streamPreview');
        this.model.rawCropCanvas = this.element.querySelector('#rawCropCanvas');
        this.model.invertRawFrameCheck = this.element.querySelector('#invertRawFrameCheck');
        this.model.cropRawFrameCheck = this.element.querySelector('#cropRawFrameCheck');
        this.model.rawCropRoiInput = this.element.querySelector('#rawCropRoiInput');
        this.model.rawCropRoiInput.onChange("change", () =>{
            setCropCoords();
        });

         
        

        this.model.cropRawFrameCheck.addEventListener("change",  () =>{
            if (this.checked) {
                show(this.model.rawCropRoiInput);
            } else {
                hide(this.model.rawCropRoiInput);
            }
        });
        hide(this.model.rawCropRoiInput);
        hide(this.model.rawCropCanvas);


        this.model.select_preset = this.element.querySelector('#select_preset');
        let i = 0
        for (presetName of sessionPresetNames) {
            var p_i = new Option(presetName, presetName)
            this.model.select_preset.options.add(p_i);
            i++;
        }
        for (let i = 0; i < this.model.select_preset.options.length; i++) {
            if (this.model.select_preset.options[i].value === 'hd1920x1080') {
                this.model.select_preset.selectedIndex = i;
                break;
            }
        }
        this.model.selectedPresetName = this.model.select_preset.options[this.model.select_preset.selectedIndex].value;
        this.model.status_test.innerHTML = this.model.selectedPresetName;

        this.model.startCameraButtonGL.addEventListener('click',  () =>{
            this.model.usingMJPEG = false
            this.model.select_preset.disabled = true;
            this.model.startCameraButtonGL.disabled = true
            this.model.startCameraButtonMJPEG.disabled = true
            this.model.stopCameraButton.disabled = false
            setCropCoords();
            show(this.model.canvasgl);
            this.model.canvasgl.parentElement.style.display = "block";
            hide(this.model.streamPreview);
            this.model.streamPreview.parentElement.style.display = "none";
            show(this.model.status_fps_preview);
            show(this.model.status_fps_raw);
            setupGLView(this.model.previewWidth, this.model.previewHeight);
            startNativeCamera(
                this.model.selectedPresetName,
                this.model.flashMode,
                this.model.onFramePreview,
                this.model.targetPreviewFPS,
                this.model.previewWidth,
                onFrameGrabbed,
                onFrameGrabbedtargetRawFPS,
                true,
                () => {
                    this.model.title_h2.innerHTML = _serverUrl;
                },
                this.model.rawCrop_x,
                this.model.rawCrop_y,
                this.model.rawCrop_w,
                this.model.rawCrop_h);
        })
        this.model.startCameraButtonMJPEG.addEventListener('click',  () =>{
            this.model.usingMJPEG = true
            this.model.select_preset.disabled = true;
            this.model.startCameraButtonGL.disabled = true
            this.model.startCameraButtonMJPEG.disabled = true
            this.model.stopCameraButton.disabled = false
            setCropCoords();
            hide(this.model.canvasgl);
            this.model.canvasgl.parentElement.style.display = "none";
            show(this.model.streamPreview);
            this.model.streamPreview.parentElement.style.display = "block";
            hide(this.model.status_fps_preview);
            show(this.model.status_fps_raw);
            startNativeCamera(
                this.model.selectedPresetName,
                this.model.flashMode,
                undefined,
                this.model.targetPreviewFPS,
                this.model.previewWidth,
                this.model.onFrameGrabbed,
                this.model.targetRawFPS,
                true,
                () => {
                    this.model.streamPreview.src = `${_serverUrl}/mjpeg`;
                    this.model.title_h2.innerHTML = _serverUrl;
                },
                this.model.rawCrop_x,
                this.model.rawCrop_y,
                this.model.rawCrop_w,
                this.model.rawCrop_h);
        });
        this.model.stopCameraButton.addEventListener('click',  () =>{
            window.close();
            stopNativeCamera();
            this.model.select_preset.disabled = false;
            this.model.startCameraButtonGL.disabled = false
            this.model.startCameraButtonMJPEG.disabled = false
            this.model.stopCameraButton.disabled = true
            time0 = undefined
            this.model.globalCounter = 0
            this.model.title_h2.innerHTML = "Camera Test"
        });

        this.model.takePictureButton1.addEventListener('click',  () =>{
            takePictureBase64NativeCamera(onPictureTaken)
        });
        this.model.takePictureButton2.addEventListener('click',  () =>{
            getSnapshot().then(b => {
                this.model.snapshotImage.src = URL.createObjectURL(b);
            });
        });

        this.model.flashButton.addEventListener('click',  () =>{
            switch (flashMode) {
                case 'off':
                    flashMode = 'flash';
                    break;
                case 'flash':
                    flashMode = 'torch';
                    break;
                case 'torch':
                    flashMode = 'off';
                    break;
                default:
                    break;
            }
            this.model.flashButton.innerHTML = `T ${flashMode}`;
            setFlashModeNativeCamera(flashMode);
        });

        hide(this.model.canvasgl);
        hide(this.model.streamPreview);
        hide(this.model.status_fps_preview)
        hide(this.model.status_fps_raw)
        //});

        this.model.wkTempMessage = "WKScanController construtor 3";
    }



    setupGLView(w, h) {
        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(75, w / h, 0.1, 10000);
        renderer = new THREE.WebGLRenderer({ canvas: canvasgl, antialias: true });

        cameraHeight = h / 2 / Math.tan(camera.fov / 2 * (Math.PI / 180))
        camera.position.set(0, 0, cameraHeight);
        let clientHeight = Math.round(h / w * canvasgl.clientWidth);
        renderer.setSize(canvasgl.clientWidth, clientHeight);

        controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.enablePan = false;
        controls.enableZoom = false;
        controls.enableRotate = false;

        const dataTexture = new Uint8Array(w * h * bytePerChannel);
        for (let i = 0; i < w * h * bytePerChannel; i++)
            dataTexture[i] = 255;
        const frameTexture = new THREE.DataTexture(dataTexture, w, h, formatTexture, THREE.UnsignedByteType);
        frameTexture.needsUpdate = true;
        const planeGeo = new THREE.PlaneBufferGeometry(w, h);
        material = new THREE.MeshBasicMaterial({
            map: frameTexture,
        });
        material.map.flipY = true;
        const plane = new THREE.Mesh(planeGeo, material);
        scene.add(plane);

        animate();
    }

    animate() {
        window.requestAnimationFrame(() => animate());
        renderer.render(scene, camera);
    }

    ChangePresetList() {
        selectedPresetName = select_preset.options[select_preset.selectedIndex].value;
        status_test.innerHTML = selectedPresetName;
    }

    setCropCoords() {
        if (cropRawFrameCheck.checked) {
            const coords = rawCropRoiInput.value.split(",");
            rawCrop_x = parseInt(coords[0]);
            rawCrop_y = parseInt(coords[1]);
            rawCrop_w = parseInt(coords[2]);
            rawCrop_h = parseInt(coords[3]);
            if (rawCrop_x != rawCrop_x || rawCrop_y != rawCrop_y || rawCrop_w != rawCrop_w || rawCrop_h != rawCrop_h) {
                alert("failed to parse coords");
                cropRawFrameCheck.checked = false;
                hide(rawCropRoiInput);
                rawCrop_x = undefined;
                rawCrop_y = undefined;
                rawCrop_w = undefined;
                rawCrop_h = undefined;
            }
        } else {
            rawCrop_x = undefined;
            rawCrop_y = undefined;
            rawCrop_w = undefined;
            rawCrop_h = undefined;
        }
        setRawCropRoi(rawCrop_x, rawCrop_y, rawCrop_w, rawCrop_h);
    }


    /**
     * @param {PLRgbImage} buffer preview data coming from native camera. Can be used to create a new Uint8Array
     * @param {number} elapsedTime time in ms elapsed to get the preview frame
     */
    onFramePreview(rgbImage, elapsedTime) {
        var frame = new Uint8Array(rgbImage.arrayBuffer);
        if (rgbImage.width !== previewWidth || rgbImage.height !== previewHeight) {
            previewWidth = rgbImage.width;
            previewHeight = rgbImage.height;
            setupGLView(previewWidth, previewHeight);
        }
        material.map = new THREE.DataTexture(frame, rgbImage.width, rgbImage.height, formatTexture, THREE.UnsignedByteType);
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
        status_fps_preview.innerHTML = `preview ${Math.round(elapsedTime)} ms (max FPS=${Math.round(previewFramesMeasuredFPS)})`;
    }

    /**
     * @param {PLRgbImage} rgbImage raw data coming from native camera. Can be used to create a new Uint8Array
     * @param {number} elapsedTime time in ms elapsed to get the raw frame
     */
    onFrameGrabbed(rgbImage, elapsedTime) {
        var rawframe = new Uint8Array(rgbImage.arrayBuffer);
        if (usingMJPEG === false) {
            pSizeText = `, p(${previewWidth}x${previewHeight}), p FPS:${targetPreviewFPS}`
        } else {
            pSizeText = ""
        }
        status_test.innerHTML = `${selectedPresetName}${pSizeText}, raw FPS:${targetRawFPS}<br/> raw frame length: ${Math.round(10 * rawframe.byteLength / 1024 / 1024) / 10}MB, ${rgbImage.width}x${rgbImage.height}`

        if (rawFramesCounter !== 0 && rawFramesCounter % (fpsMeasurementInterval - 1) === 0) {
            rawFramesMeasuredFPS = 1000 / rawFramesElapsedSum * fpsMeasurementInterval;
            rawFramesCounter = 0;
            rawFramesElapsedSum = 0;
        } else {
            rawFramesCounter += 1;
            rawFramesElapsedSum += elapsedTime;
        }
        status_fps_raw.innerHTML = `raw ${Math.round(elapsedTime)} ms (max FPS=${Math.round(rawFramesMeasuredFPS)})`
        placeUint8RGBArrayInCanvas(rawCropCanvas, rawframe, rgbImage.width, rgbImage.height);
        show(rawCropCanvas);
    }

    onPictureTaken(base64ImageData) {
        console.log(`Inside onPictureTaken`)
        snapshotImage.src = base64ImageData
    }

    hide(element) {
        element.style.display = "none";
    }

    show(element) {
        element.style.display = "block";
    }

    placeUint8RGBArrayInCanvas(canvasElem, array, w, h) {
        let a = 1;
        let b = 0;
        if (invertRawFrameCheck.checked === true) {
            a = -1;
            b = 255;
        }
        canvasElem.width = w;
        canvasElem.height = h;
        var ctx = canvasElem.getContext('2d');
        var clampedArray = new Uint8ClampedArray(w * h * 4);
        let j = 0
        for (let i = 0; i < 3 * w * h; i += 3) {
            clampedArray[j] = b + a * array[i];
            clampedArray[j + 1] = b + a * array[i + 1];
            clampedArray[j + 2] = b + a * array[i + 2];
            clampedArray[j + 3] = 255;
            j += 4;
        }
        var imageData = new ImageData(clampedArray, w, h);
        ctx.putImageData(imageData, 0, 0);
    }
}
