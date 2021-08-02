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
        
        var renderer, camera, scene, canvasgl;
        var material;
        var previewWidth = 360;
        var previewHeight = Math.round(previewWidth * 16 / 9); // assume 16:9 portrait at start
        var targetPreviewFPS = 25;
        var fpsMeasurementInterval = 5;
        var previewFramesCounter = 0;
        var previewFramesElapsedSum = 0;
        var previewFramesMeasuredFPS = 0;
        var targetRawFPS = 10;
        var rawCrop_x = undefined;
        var rawCrop_y = undefined;
        var rawCrop_w = undefined;
        var rawCrop_h = undefined;
        var rawFramesCounter = 0;
        var rawFramesElapsedSum = 0;
        var rawFramesMeasuredFPS = 0;
        var elapsed = 0
        var controls;
        const bytePerChannel = 3;
        if (bytePerChannel === 4) {
            formatTexture = THREE.RGBAFormat;
        } else if (bytePerChannel === 3) {
            formatTexture = THREE.RGBFormat;
        }
        var formatTexture;
        var flashMode = 'off'
        var usingMJPEG = false

        this.model.wkTempMessage = "WKScanController construtor 2";

        document.addEventListener("DOMContentLoaded", () => {
            status_test = document.getElementById('status_test');
            status_fps_preview = document.getElementById('status_fps_preview');
            status_fps_raw = document.getElementById('status_fps_raw');
        
            startCameraButtonGL = document.getElementById('startCameraButtonGL');
            startCameraButtonMJPEG = document.getElementById('startCameraButtonMJPEG');
            stopCameraButton = document.getElementById('stopCameraButton');
            stopCameraButton.disabled = true
        
            title_h2 = document.getElementById('title_id');
            takePictureButton1 = document.getElementById('takePictureButton1');
            takePictureButton2 = document.getElementById('takePictureButton2');
            flashButton = document.getElementById('flashButton');
            snapshotImage = document.getElementById('snapshotImage');
        
            
            canvasgl = document.getElementById('cameraCanvas');
            streamPreview = document.getElementById('streamPreview');
            rawCropCanvas = document.getElementById('rawCropCanvas');
            invertRawFrameCheck = document.getElementById('invertRawFrameCheck');
            cropRawFrameCheck = document.getElementById('cropRawFrameCheck');
            rawCropRoiInput = document.getElementById('rawCropRoiInput');
            rawCropRoiInput.addEventListener('change', function() {
                setCropCoords();
            })
            cropRawFrameCheck.addEventListener('change', function() {
                if (this.checked) {
                    show(rawCropRoiInput);        
                } else {
                    hide(rawCropRoiInput);
                }
            });
            hide(rawCropRoiInput);
            hide(rawCropCanvas);
        
        
            select_preset = document.getElementById('select_preset');
            let i = 0
            for (presetName of sessionPresetNames) {
                var p_i = new Option(presetName, presetName)
                select_preset.options.add(p_i);
                i++;
            }
            for (let i = 0; i < select_preset.options.length; i++) {
                if (select_preset.options[i].value === 'hd1920x1080') {
                    select_preset.selectedIndex = i;
                    break;
                }
            }
            selectedPresetName = select_preset.options[select_preset.selectedIndex].value;
            status_test.innerHTML = selectedPresetName;
        
            startCameraButtonGL.addEventListener('click', function(e) {
                usingMJPEG = false
                select_preset.disabled = true;
                startCameraButtonGL.disabled = true
                startCameraButtonMJPEG.disabled = true
                stopCameraButton.disabled = false
                setCropCoords();
                show(canvasgl);
                canvasgl.parentElement.style.display = "block";
                hide(streamPreview);
                streamPreview.parentElement.style.display = "none";
                show(status_fps_preview);
                show(status_fps_raw);
                setupGLView(previewWidth, previewHeight);
                startNativeCamera(
                    selectedPresetName, 
                    flashMode, 
                    onFramePreview, 
                    targetPreviewFPS, 
                    previewWidth, 
                    onFrameGrabbed, 
                    targetRawFPS, 
                    true,
                    () => {
                        title_h2.innerHTML = _serverUrl;
                    },
                    rawCrop_x,
                    rawCrop_y,
                    rawCrop_w,
                    rawCrop_h);
            })
            startCameraButtonMJPEG.addEventListener('click', function(e) {
                usingMJPEG = true
                select_preset.disabled = true;
                startCameraButtonGL.disabled = true
                startCameraButtonMJPEG.disabled = true
                stopCameraButton.disabled = false
                setCropCoords();
                hide(canvasgl);
                canvasgl.parentElement.style.display = "none";
                show(streamPreview);
                streamPreview.parentElement.style.display = "block";
                hide(status_fps_preview);
                show(status_fps_raw);
                startNativeCamera(
                    selectedPresetName, 
                    flashMode, 
                    undefined, 
                    targetPreviewFPS, 
                    previewWidth, 
                    onFrameGrabbed, 
                    targetRawFPS,
                    true, 
                    () => {
                        streamPreview.src = `${_serverUrl}/mjpeg`;
                        title_h2.innerHTML = _serverUrl;
                    },
                    rawCrop_x,
                    rawCrop_y,
                    rawCrop_w,
                    rawCrop_h);
            });
            stopCameraButton.addEventListener('click', function(e) {
                window.close(); 
                stopNativeCamera();
                select_preset.disabled = false;
                startCameraButtonGL.disabled = false
                startCameraButtonMJPEG.disabled = false
                stopCameraButton.disabled = true
                time0 = undefined
                globalCounter = 0
                title_h2.innerHTML = "Camera Test"
            });
        
            takePictureButton1.addEventListener('click', function(e) {
                takePictureBase64NativeCamera(onPictureTaken)
            });
            takePictureButton2.addEventListener('click', function(e) {
                getSnapshot().then( b => {
                    snapshotImage.src = URL.createObjectURL(b);
                });
            });
        
            flashButton.addEventListener('click', function(e) {
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
                flashButton.innerHTML = `T ${flashMode}`;
                setFlashModeNativeCamera(flashMode);
            });
        
            hide(canvasgl);
            hide(streamPreview);
            hide(status_fps_preview)
            hide(status_fps_raw)
        });

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
