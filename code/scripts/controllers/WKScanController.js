import ContainerController from '../../cardinal/controllers/base-controllers/ContainerController.js';
const gtinResolver = require("gtin-resolver");

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

class PLYCbCrImage {
    /** creates a PLYCbCrImage. The Y-plane and CbCr interpleaved plane are copied seperately.
     * @param  {ArrayBuffer} arrayBuffer raw data
     * @param  {Number} width image width, must be even
     * @param  {Number} height image height, must be even
     */
    constructor(arrayBuffer, width, height) {
        this.width = width;
        this.height = height;
        if (!Number.isInteger(this.width / 2) || !Number.isInteger(this.height / 2)) {
            throw `Only even width and height is supported, got w=${this.width}, h=${this.height} `
        }
        this.yArrayBuffer = arrayBuffer.slice(0, this.width * this.height);
        this.cbCrArrayBuffer = arrayBuffer.slice(this.width * this.height)
    }
}

export default class WKScanController extends ContainerController {
    constructor(element, history) {
        super(element, history);
        this.setModel({
            data: '', hasCode: false, hasError: false, nativeSupport: false,
            useScandit: false
        });
        if (window != undefined) {
            window.model = this.model;
            window.onNativeCameraInitialized = this.onNativeCameraInitialized;
            window.onPictureTaken = this.onPictureTaken;
            window.getPreviewFrame = this.getPreviewFrame;
            window.getRawFrame = this.getRawFrame;
            window.getSnapshot = this.getSnapshot;
            window.getPLRgbImageFromResponse = this.getPLRgbImageFromResponse;
            window.onFrameGrabbed = this.onFrameGrabbed;
            window.onFramePreview = this.onFramePreview;
            window.onCameraInitializedCallBack = this.onCameraInitializedCallBack;
        } else {
            console.log("window is undefined");
        }

        this.cameraProps = {};
        this.cameraProps.serverUrl = undefined;
        this.cameraProps.previewHandle = undefined;
        this.cameraProps.grabHandle = undefined;
        this.cameraProps.targetPreviewFps = 20;
        this.cameraProps.serverUrl = undefined;
        this.cameraProps.cameraRunning = false;
        this.cameraProps.targetGrabFps = 10;


        this.cameraProps.renderer = undefined;
        this.cameraProps.camera = undefined;
        this.cameraProps.scene = undefined;
        this.cameraProps.canvasgl = undefined;
        this.cameraProps.material = undefined;
        this.cameraProps.previewWidth = 360;
        this.cameraProps.previewHeight = Math.round(this.cameraProps.previewWidth * 16 / 9); // assume 16:9 portrait at start
        this.cameraProps.targetPreviewFPS = 25;
        this.cameraProps.fpsMeasurementInterval = 5;
        this.cameraProps.previewFramesCounter = 0;
        this.cameraProps.previewFramesElapsedSum = 0;
        this.cameraProps.previewFramesMeasuredFPS = 0;
        this.cameraProps.targetRawFPS = 10;
        this.cameraProps._ycbcr = false;
        this.cameraProps.rawCrop_x = undefined;
        this.cameraProps.rawCrop_y = undefined;
        this.cameraProps.rawCrop_w = undefined;
        this.cameraProps.rawCrop_h = undefined;
        this.cameraProps._x = undefined;
        this.cameraProps._y = undefined;
        this.cameraProps._w = undefined;
        this.cameraProps._h = undefined;

        this.cameraProps.rawFramesCounter = 0;
        this.cameraProps.rawFramesElapsedSum = 0;
        this.cameraProps.rawFramesMeasuredFPS = 0;
        this.cameraProps.elapsed = 0
        this.cameraProps.controls;
        this.cameraProps.formatTexture = THREE.RGBFormat;

        const bytePerChannel = 3;
        if (bytePerChannel === 4) {
            this.cameraProps.formatTexture = THREE.RGBAFormat;
        } else if (bytePerChannel === 3) {
            this.cameraProps.formatTexture = THREE.RGBFormat;
        }

        this.cameraProps.flashMode = 'off'
        this.cameraProps.usingMJPEG = false

        window.cameraProps = this.cameraProps;

        this.cameraProps.status_test = this.element.querySelector('#status_test');
        this.cameraProps.status_fps_preview = this.element.querySelector('#status_fps_preview');
        this.cameraProps.status_fps_raw = this.element.querySelector('#status_fps_raw');

        this.cameraProps.startCameraButtonGL = this.element.querySelector('#startCameraButtonGL');
        this.cameraProps.startCameraButtonMJPEG = this.element.querySelector('#startCameraButtonMJPEG');
        this.cameraProps.stopCameraButton = this.element.querySelector('#stopCameraButton');
        this.cameraProps.stopCameraButton.disabled = true

        this.cameraProps.takePictureButton1 = this.element.querySelector('#takePictureButton1');
        this.cameraProps.takePictureButton2 = this.element.querySelector('#takePictureButton2');
        this.cameraProps.flashButton = this.element.querySelector('#flashButton');


        this.cameraProps.torchLevelRangeLabel = this.element.querySelector('#torchLevelRangeLabel');

        this.cameraProps.torchRange = this.element.querySelector('#torchLevelRange');
        this.cameraProps.torchRange.addEventListener('change', () => {
            let level = parseFloat(this.cameraProps.torchRange.value);
            if (level != level) {
                alert('failed to parse torch level value');
            } else {
                this.setTorchLevelNativeCamera(level);
                this.cameraProps.torchLevelRangeLabel.innerHTML = `Torch Level: ${this.cameraProps.torchRange.value}`;
            }
        })

        this.cameraProps.torchRange.value = "1.0";
        this.cameraProps.torchLevelRangeLabel.innerHTML = `Torch Level: ${this.cameraProps.torchRange.value}`;
        this.cameraProps.torchRange.disabled = true;

        this.cameraProps.configInfo = this.element.querySelector('#configInfo');
        this.cameraProps.getConfigButton = this.element.querySelector('#getConfigButton');
        this.cameraProps.getConfigButton.addEventListener("click", (e) => {
            this.getCameraConfiguration()
                .then(data => {
                    this.cameraProps.configInfo.innerHTML = JSON.stringify(data);
                })
        });

        this.cameraProps.colorspaceButton = this.element.querySelector('#colorspaceButton');


        this.cameraProps.colorspaceButton.addEventListener('click', (e) => {
            let nextColorspace = '';
            switch (this.cameraProps.colorspaceButton.innerHTML) {
                case 'sRGB':
                    nextColorspace = 'HLG_BT2020';
                    break;
                case 'HLG_BT2020':
                    nextColorspace = 'P3_D65';
                    break;
                default:
                    nextColorspace = 'sRGB';
                    break;
            }
            this.cameraProps.colorspaceButton.innerHTML = nextColorspace;
            this.setPreferredColorSpaceNativeCamera(nextColorspace);
        });



        this.cameraProps.snapshotImage = this.element.querySelector('#snapshotImage');

        this.cameraProps.canvasgl = this.element.querySelector('#cameraCanvas');
        this.cameraProps.streamPreview = this.element.querySelector('#streamPreview');

        this.cameraProps.rawCropCanvas = this.element.querySelector('#rawCropCanvas');
        this.cameraProps.rawCropCbCanvas = this.element.querySelector('#rawCropCbCanvas');
        this.cameraProps.rawCropCrCanvas = this.element.querySelector('#rawCropCrCanvas');

        this.cameraProps.invertRawFrameCheck = this.element.querySelector('#invertRawFrameCheck');
        this.cameraProps.cropRawFrameCheck = this.element.querySelector('#cropRawFrameCheck');
        this.cameraProps.cropRawFrameCheck.enabled = true;

        this.cameraProps.cropRawFrameCheck.addEventListener('click', (e) => {
            this.cameraProps.cropRawFrameCheck.checked = !this.cameraProps.cropRawFrameCheck.checked;
        });
        this.cameraProps.rawCropRoiInput = this.element.querySelector('#rawCropRoiInput');
        this.cameraProps.rawCropRoiInput.addEventListener("change", () => {
            this.setCropCoords();
        });


        this.cameraProps.cropRawFrameCheck.addEventListener("change", () => {
            if (this.checked) {
                this.show(this.cameraProps.rawCropRoiInput);
            } else {
                this.hide(this.cameraProps.rawCropRoiInput);
            }
        });
        this.hide(this.cameraProps.rawCropRoiInput);
        this.hide(this.cameraProps.rawCropCanvas);
        this.hide(this.cameraProps.rawCropCbCanvas);
        this.hide(this.cameraProps.rawCropCrCanvas);



        this.cameraProps.select_preset = this.element.querySelector('#select_preset');

        let i = 0;
        for (let presetName of sessionPresetNames) {
            var p_i = new Option(presetName, presetName)
            this.cameraProps.select_preset.options.add(p_i);
            i++;
        }

        for (let i = 0; i < this.cameraProps.select_preset.options.length; i++) {
            if (this.cameraProps.select_preset.options[i].value === 'hd1920x1080') {
                this.cameraProps.select_preset.selectedIndex = i;
                break;
            }
        }
        this.cameraProps.selectedPresetName = this.cameraProps.select_preset.options[this.cameraProps.select_preset.selectedIndex].value;
        this.cameraProps.status_test.innerHTML = this.cameraProps.selectedPresetName;

        this.cameraProps.startCameraButtonGL.addEventListener('click', () => {

            this.cameraProps.usingMJPEG = false;
            this.cameraProps.select_preset.disabled = true;
            this.cameraProps.startCameraButtonGL.disabled = true
            this.cameraProps.startCameraButtonMJPEG.disabled = true
            this.cameraProps.stopCameraButton.disabled = false

            this.setCropCoords();
            this.show(this.cameraProps.canvasgl);
            this.cameraProps.canvasgl.parentElement.style.display = "block";
            this.hide(this.cameraProps.streamPreview);
            this.cameraProps.streamPreview.parentElement.style.display = "none";
            this.show(this.cameraProps.status_fps_preview);
            this.show(this.cameraProps.status_fps_raw);
            this.setupGLView(this.cameraProps.previewWidth, this.cameraProps.previewHeight);

            this.startNativeCamera(
                this.cameraProps.selectedPresetName,
                this.cameraProps.flashMode,
                "onFramePreview",
                this.cameraProps.targetPreviewFPS,
                this.cameraProps.previewWidth,
                "onFrameGrabbed",
                this.cameraProps.targetRawFPS,
                true,
                undefined,
                this.cameraProps.rawCrop_x,
                this.cameraProps.rawCrop_y,
                this.cameraProps.rawCrop_w,
                this.cameraProps.rawCrop_h);
        });
        this.cameraProps.startCameraButtonMJPEG.addEventListener('click', () => {
            this.cameraProps.usingMJPEG = true
            this.cameraProps.select_preset.disabled = true;
            this.cameraProps.startCameraButtonGL.disabled = true
            this.cameraProps.startCameraButtonMJPEG.disabled = true
            this.cameraProps.stopCameraButton.disabled = false
            this.setCropCoords();
            this.hide(this.cameraProps.canvasgl);
            this.cameraProps.canvasgl.parentElement.style.display = "none";
            this.show(this.cameraProps.streamPreview);
            this.cameraProps.streamPreview.parentElement.style.display = "block";
            this.hide(this.cameraProps.status_fps_preview);
            this.show(this.cameraProps.status_fps_raw);
            this.startNativeCamera(
                this.cameraProps.selectedPresetName,
                this.cameraProps.flashMode,
                undefined,
                this.cameraProps.targetPreviewFPS,
                this.cameraProps.previewWidth,
                "onFrameGrabbed",
                this.cameraProps.targetRawFPS,
                true,
                "onCameraInitializedCallBack",
                this.cameraProps.rawCrop_x,
                this.cameraProps.rawCrop_y,
                this.cameraProps.rawCrop_w,
                this.cameraProps.rawCrop_h);
        });
        this.cameraProps.stopCameraButton.addEventListener('click', () => {
            window.close();
            this.stopNativeCamera();
            this.cameraProps.select_preset.disabled = false;
            this.cameraProps.startCameraButtonGL.disabled = false
            this.cameraProps.startCameraButtonMJPEG.disabled = false
            this.cameraProps.stopCameraButton.disabled = true
            time0 = undefined
            this.cameraProps.globalCounter = 0
            //this.cameraProps.title_h2.innerHTML = "Camera Test"
        });

        this.cameraProps.takePictureButton1.addEventListener('click', () => {
            this.takePictureBase64NativeCamera(onPictureTaken)
        });
        this.cameraProps.takePictureButton2.addEventListener('click', () => {
            this.getSnapshot().then(b => {
                this.cameraProps.snapshotImage.src = URL.createObjectURL(b);
            });
        });

        this.cameraProps.flashButton.addEventListener('click', () => {
            switch (this.cameraProps.flashMode) {
                case 'off':
                    this.cameraProps.flashMode = 'flash';
                    break;
                case 'flash':
                    this.cameraProps.flashMode = 'torch';
                    this.cameraProps.torchRange.disabled = false;
                    break;
                case 'torch':
                    this.cameraProps.flashMode = 'off';
                    this.cameraProps.torchRange.disabled = true;
                    break;
                default:
                    break;
            }
            this.cameraProps.flashButton.innerHTML = `T ${this.cameraProps.flashMode}`;
            this.setFlashModeNativeCamera(this.cameraProps.flashMode);
        });

        this.hide(this.cameraProps.canvasgl);
        this.hide(this.cameraProps.streamPreview);
        this.hide(this.cameraProps.status_fps_preview);
        this.hide(this.cameraProps.status_fps_raw);
    }


    onCameraInitializedCallBack() {
        this.cameraProps.streamPreview.src = `${this.cameraProps.serverUrl}/mjpeg`;

    }

    setupGLView(w, h) {
        this.cameraProps.scene = new THREE.Scene();
        this.cameraProps.camera = new THREE.PerspectiveCamera(75, w / h, 0.1, 10000);
        this.cameraProps.renderer = new THREE.WebGLRenderer({ canvas: this.cameraProps.canvasgl, antialias: true });

        let cameraHeight = h / 2 / Math.tan(this.cameraProps.camera.fov / 2 * (Math.PI / 180));
        this.cameraProps.camera.position.set(0, 0, cameraHeight);
        let clientHeight = Math.round(h / w * this.cameraProps.canvasgl.clientWidth);
        this.cameraProps.renderer.setSize(this.cameraProps.canvasgl.clientWidth, clientHeight);

        this.cameraProps.controls = new THREE.OrbitControls(this.cameraProps.camera, this.cameraProps.renderer.domElement);
        this.cameraProps.controls.enablePan = false;
        this.cameraProps.controls.enableZoom = false;
        this.cameraProps.controls.enableRotate = false;
        const dataTexture = new Uint8Array(w * h * this.cameraProps.bytePerChannel);
        for (let i = 0; i < w * h * this.cameraProps.bytePerChannel; i++)
            dataTexture[i] = 255;
        const frameTexture = new THREE.DataTexture(dataTexture, w, h, this.cameraProps.formatTexture, THREE.UnsignedByteType);
        frameTexture.needsUpdate = true;
        const planeGeo = new THREE.PlaneBufferGeometry(w, h);
        this.cameraProps.material = new THREE.MeshBasicMaterial({
            map: frameTexture,
        });

        this.cameraProps.material.map.flipY = true;
        const plane = new THREE.Mesh(planeGeo, this.cameraProps.material);
        this.cameraProps.scene.add(plane);
        this.animate();
    }




    /**
     * Sets the raw crop to a new position
     * @param  {number} x
     * @param  {number} y
     * @param  {number} w
     * @param  {number} h
     */
    setRawCropRoi(x, y, w, h) {
        this.cameraProps._x = x;
        this.cameraProps._y = y;
        this.cameraProps._w = w;
        this.cameraProps._h = h;
    }



    animate() {
        window.requestAnimationFrame(() => this.animate());
        this.cameraProps.renderer.render(this.cameraProps.scene, this.cameraProps.camera);
    }

    ChangePresetList() {
        let selectedPresetName = this.cameraProps.select_preset.options[this.cameraProps.select_preset.selectedIndex].value;
        this.cameraProps.status_test.innerHTML = selectedPresetName;
    }

    setCropCoords() {
        if (this.cameraProps.cropRawFrameCheck.checked) {
            const coords = this.cameraProps.rawCropRoiInput.value.split(",");
            this.cameraProps.rawCrop_x = parseInt(coords[0]);
            this.cameraProps.rawCrop_y = parseInt(coords[1]);
            this.cameraProps.rawCrop_w = parseInt(coords[2]);
            this.cameraProps.rawCrop_h = parseInt(coords[3]);
            if (this.cameraProps.rawCrop_x != this.cameraProps.rawCrop_x ||
                this.cameraProps.rawCrop_y != this.cameraProps.rawCrop_y ||
                this.cameraProps.rawCrop_w != this.cameraProps.rawCrop_w ||
                this.cameraProps.rawCrop_h != this.cameraProps.rawCrop_h) {
                alert("failed to parse coords");
                this.cameraProps.cropRawFrameCheck.checked = false;
                this.hide(rawCropRoiInput);
                this.cameraProps.rawCrop_x = undefined;
                this.cameraProps.rawCrop_y = undefined;
                this.cameraProps.rawCrop_w = undefined;
                this.cameraProps.rawCrop_h = undefined;
            }
        } else {
            this.cameraProps.rawCrop_x = undefined;
            this.cameraProps.rawCrop_y = undefined;
            this.cameraProps.rawCrop_w = undefined;
            this.cameraProps.rawCrop_h = undefined;
        }
        this.setRawCropRoi(this.cameraProps.rawCrop_x, this.cameraProps.rawCrop_y, this.cameraProps.rawCrop_w, this.cameraProps.rawCrop_h);
    }


    /**
     * @param {PLRgbImage} buffer preview data coming from native camera. Can be used to create a new Uint8Array
     * @param {number} elapsedTime time in ms elapsed to get the preview frame
     */
    onFramePreview(rgbImage, elapsedTime) {
        var frame = new Uint8Array(rgbImage.arrayBuffer);
        if (rgbImage.width !== this.cameraProps.previewWidth || rgbImage.height !== this.cameraProps.previewHeight) {
            this.cameraProps.previewWidth = rgbImage.width;
            this.cameraProps.previewHeight = rgbImage.height;
            this.setupGLView(this.cameraProps.previewWidth, this.cameraProps.previewHeight);
        }
        this.cameraProps.material.map = new THREE.DataTexture(frame, rgbImage.width, rgbImage.height, this.cameraProps.formatTexture, THREE.UnsignedByteType);
        this.cameraProps.material.map.flipY = true;
        this.cameraProps.material.needsUpdate = true;


        if (this.cameraProps.previewFramesCounter !== 0 && this.cameraProps.previewFramesCounter % (this.cameraProps.fpsMeasurementInterval - 1) === 0) {
            this.cameraProps.previewFramesMeasuredFPS = 1000 / this.cameraProps.previewFramesElapsedSum * this.cameraProps.fpsMeasurementInterval;
            this.cameraProps.previewFramesCounter = 0;
            this.cameraProps.previewFramesElapsedSum = 0;
        } else {
            this.cameraProps.previewFramesCounter += 1;
            this.cameraProps.previewFramesElapsedSum += elapsedTime;
        }
        this.cameraProps.status_fps_preview.innerHTML = `preview ${Math.round(elapsedTime)} ms (max FPS=${Math.round(this.cameraProps.previewFramesMeasuredFPS)})`;
    }

    /**
     * @param {PLRgbImage | PLYCbCrImage} plImage raw data coming from native camera
     * @param {number} elapsedTime time in ms elapsed to get the raw frame
     */
    onFrameGrabbed(plImage, elapsedTime) {
        var pSizeText = "";
        if (this.cameraProps.usingMJPEG === false) {
            pSizeText = `, p(${this.cameraProps.previewWidth}x${this.cameraProps.previewHeight}), p FPS:${this.cameraProps.targetPreviewFPS}`;
        }
        let rawframeLengthMB = undefined
        if (plImage instanceof PLRgbImage) {
            rawframeLengthMB = Math.round(10 * plImage.arrayBuffer.byteLength / 1024 / 1024) / 10;
            this.placeUint8RGBArrayInCanvas(rawCropCanvas, new Uint8Array(plImage.arrayBuffer), plImage.width, plImage.height);
            this.show(this.cameraProps.rawCropCanvas);
            this.hide(this.cameraProps.rawCropCbCanvas);
            this.hide(this.cameraProps.rawCropCrCanvas);
        } else if (plImage instanceof PLYCbCrImage) {
            rawframeLengthMB = Math.round(10 * (plImage.yArrayBuffer.byteLength + plImage.cbCrArrayBuffer.byteLength) / 1024 / 1024) / 10;
            this.placeUint8GrayScaleArrayInCanvas(this.cameraProps.rawCropCanvas, new Uint8Array(plImage.yArrayBuffer), plImage.width, plImage.height);
            this.show(this.cameraProps.rawCropCanvas);
            this.placeUint8CbCrArrayInCanvas(this.cameraProps.rawCropCbCanvas, this.cameraProps.rawCropCrCanvas, new Uint8Array(plImage.cbCrArrayBuffer), plImage.width / 2, plImage.height / 2);
            this.show(this.cameraProps.rawCropCbCanvas);
            this.show(this.cameraProps.rawCropCrCanvas);
        } else {
            rawframeLengthMB = -1
        }


        this.cameraProps.status_test.innerHTML = `${this.cameraProps.selectedPresetName}${pSizeText}, raw FPS:${this.cameraProps.targetRawFPS}<br/> raw frame length: ${Math.round(10 * rawframe.byteLength / 1024 / 1024) / 10}MB, ${rgbImage.width}x${rgbImage.height}`;

        if (this.cameraProps.rawFramesCounter !== 0 && this.cameraProps.rawFramesCounter % (this.cameraProps.fpsMeasurementInterval - 1) === 0) {
            this.cameraProps.rawFramesMeasuredFPS = 1000 / this.cameraProps.rawFramesElapsedSum * this.cameraProps.fpsMeasurementInterval;
            this.cameraProps.rawFramesCounter = 0;
            this.cameraProps.rawFramesElapsedSum = 0;
        } else {
            this.cameraProps.rawFramesCounter += 1;
            this.cameraProps.rawFramesElapsedSum += elapsedTime;
        }
        this.cameraProps.status_fps_raw.innerHTML = `raw ${Math.round(elapsedTime)} ms (max FPS=${Math.round(rawFramesMeasuredFPS)})`;
    }

    onPictureTaken(base64ImageData) {
        this.cameraProps.snapshotImage.src = base64ImageData;
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
        if (this.cameraProps.invertRawFrameCheck.checked === true) {
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

    placeUint8GrayScaleArrayInCanvas(canvasElem, array, w, h) {
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
        for (let i = 0; i < w * h; i++) {
            clampedArray[j] = b + a * array[i];
            clampedArray[j + 1] = b + a * array[i];
            clampedArray[j + 2] = b + a * array[i];
            clampedArray[j + 3] = 255;
            j += 4;
        }
        var imageData = new ImageData(clampedArray, w, h);
        ctx.putImageData(imageData, 0, 0);
    }

    placeUint8CbCrArrayInCanvas(canvasElemCb, canvasElemCr, array, w, h) {
        canvasElemCb.width = w;
        canvasElemCb.height = h;
        canvasElemCr.width = w;
        canvasElemCr.height = h;
        var ctxCb = canvasElemCb.getContext('2d');
        var ctxCr = canvasElemCr.getContext('2d');
        var clampedArrayCb = new Uint8ClampedArray(w * h * 4);
        var clampedArrayCr = new Uint8ClampedArray(w * h * 4);
        let j = 0
        for (let i = 0; i < 2 * w * h; i += 2) {
            clampedArrayCb[j] = array[i];
            clampedArrayCb[j + 1] = array[i];
            clampedArrayCb[j + 2] = array[i];
            clampedArrayCb[j + 3] = 255;
            clampedArrayCr[j] = array[i + 1];
            clampedArrayCr[j + 1] = array[i + 1];
            clampedArrayCr[j + 2] = array[i + 1];
            clampedArrayCr[j + 3] = 255;
            j += 4;
        }
        var imageDataCb = new ImageData(clampedArrayCb, w, h);
        ctxCb.putImageData(imageDataCb, 0, 0);
        var imageDataCr = new ImageData(clampedArrayCr, w, h);
        ctxCr.putImageData(imageDataCr, 0, 0);
    }


    callNative(api, args, callback) {
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

    startNativeCamera(sessionPresetName, flashMode, onFramePreviewCallback = undefined, targetPreviewFps = 25, previewWidth = 640, onFrameGrabbedCallBack = undefined, targetGrabFps = 10, auto_orientation_enabled = false, onCameraInitializedCallBack = undefined, x = undefined, y = undefined, w = undefined, h = undefined, ycbcr = false) {

        this.cameraProps.targetPreviewFps = targetPreviewFps;
        this.cameraProps.onFramePreviewCallback = onFramePreviewCallback;
        this.cameraProps.onFrameGrabbedCallBack = onFrameGrabbedCallBack;
        this.cameraProps.onCameraInitializedCallBack = onCameraInitializedCallBack
        this.cameraProps.targetGrabFps = targetGrabFps
        this.cameraProps._ycbcr = ycbcr;
        this.setRawCropRoi(x, y, w, h);
        let params = {
            "onInitializedJsCallback": "onNativeCameraInitialized",
            "sessionPreset": sessionPresetName,
            "flashMode": flashMode,
            "previewWidth": previewWidth,
            "auto_orientation_enabled": auto_orientation_enabled
        }
        this.callNative("StartCamera", params);
    }

    /**
 * Stops the native camera
 */
    stopNativeCamera() {
        clearInterval(this.cameraProps.previewHandle)
        this.cameraProps.previewHandle = undefined
        clearInterval(this.cameraProps.grabHandle)
        this.cameraProps.grabHandle = undefined
        this.callNative("StopCamera")
    }

    /**
     * Takes a photo and return it as base64 string ImageData in callback function
     * @param  {function} onCaptureCallback callback reached when the picture is taken
     */
    takePictureBase64NativeCamera(onCaptureCallback) {
        this.callNative("TakePicture", { "onCaptureJsCallback": onCaptureCallback.name });
    }

    /**
     * @returns {Promise<Blob>} gets a JPEG snapshot
     */
    getSnapshot() {
        return fetch(`${this.cameraProps.serverUrl}/snapshot`)
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
    setFlashModeNativeCamera(mode) {
        this.callNative("SetFlashMode", { "mode": mode })
    }

    getCameraConfiguration() {
        let fetchString = `${this.cameraProps.serverUrl}/cameraconfig`;
        return fetch(fetchString)
            .then(response => {
                return response.json()
            })
    }


    /**
     * Control camera flash mode
     * @param  {string} mode can be `torch`, `flash`, or `off`, all other values will be treated as `auto`
     */
    setFlashModeNativeCamera(mode) {
        this.callNative("SetFlashMode", { "mode": mode })
    }

    /**
     * Control camera torch level
     * @param  {number} level torch level between (0.0, 1.0]
     */
    setTorchLevelNativeCamera(level) {
        this.callNative("SetTorchLevel", { "level": level })
    }

    /**
     * Control preferred colorspace. The call may not succeed if the colorspace is not available. 
     * In this case the colorspace is reverted to undefined. 
     * @param  {string} colorspace 'sRGB', 'HLG_BT2020', 'P3_D65'
     */
    setPreferredColorSpaceNativeCamera(colorspace) {
        this.callNative("SetPreferredColorSpace", { "colorspace": colorspace })
    }

    onNativeCameraInitialized(wsPort) {
        this.cameraProps.serverUrl = `http://localhost:${wsPort}`;
        if (this.cameraProps.onFramePreviewCallback !== undefined) {
            this.cameraProps.previewHandle = setInterval(() => {
                let t0 = performance.now();
                this.getPreviewFrame().then(image => {
                    if (image instanceof PLRgbImage) {
                        this.onFramePreview(image, performance.now() - t0)
                    }
                });
            }, 1000 / this.cameraProps.targetPreviewFps);
        }

        if (this.cameraProps.onFrameGrabbedCallBack !== undefined) {
            this.cameraProps.grabHandle = setInterval(() => {
                let t0 = performance.now();
                if (this.cameraProps._ycbcr) {
                    this.getRawFrameYCbCr(this.cameraProps._x, this.cameraProps._y, this.cameraProps._w, this.cameraProps._h).then(image => {
                        if (image instanceof PLYCbCrImage) {
                            this.onFrameGrabbed(image, performance.now() - t0);
                        }
                    })
                } else {
                    this.getRawFrame(_x, _y, _w, _h).then(image => {
                        if (image instanceof PLRgbImage) {
                            this.onFrameGrabbed(image, performance.now() - t0);
                        }
                    })
                }
            }, 1000 / this.cameraProps.targetGrabFps)
        }
        if (this.cameraProps.onCameraInitializedCallBack !== undefined) {
            setTimeout(() => {
                this.onCameraInitializedCallBack();
            }, 500);
        }
    }

    /**
     * @returns  {Promise<PLRgbImage>} gets a downsampled RGB frame for preview
     */
    getPreviewFrame() {

        return fetch(`${this.cameraProps.serverUrl}/previewframe`)
            .then(response => {
                let image = this.getPLRgbImageFromResponse(response);
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
    getRawFrame(x = undefined, y = undefined, w = undefined, h = undefined) {
        let fetchString = `${this.cameraProps.serverUrl}/rawframe`;
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
                let image = this.getPLRgbImageFromResponse(response);
                return image;
            })
            .catch(error => {
                console.log(error);
            })
    }

    /** Get a raw YCbCr 420 frame A ROI can be specified, corresponds to endpoint /rawframe_ycbcr
     * @param  {number} [x=undefined]
     * @param  {number} [y=undefined]
     * @param  {number} [w=undefined]
     * @param  {number} [h=undefined]
     * @returns {Promise<Void | PLYCbCrImage>} a raw YCbCr frame
     */
    getRawFrameYCbCr(x = undefined, y = undefined, w = undefined, h = undefined) {
        let fetchString = `${this.cameraProps.serverUrl}/rawframe_ycbcr`;
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
            // @ts-ignore
            const urlParams = new URLSearchParams(params);
            fetchString = `${fetchString}?${urlParams.toString()}`;
        }
        return fetch(fetchString)
            .then(response => {
                let image = this.getPLYCbCrImageFromResponse(response);
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
    getPLRgbImageFromResponse(response) {
        let frame_w = 0
        let frame_h = 0
        if (response.headers.has("image-width")) {
            frame_w = parseInt(response.headers.get("image-width"));
        } else {
            frame_w = this.cameraProps.previewWidth;
        }
        if (response.headers.has("image-height")) {
            frame_h = parseInt(response.headers.get("image-height"));
        } else {
            frame_h = this.cameraProps.previewHeight;
        }

        return response.blob().then(b => {
            return b.arrayBuffer().then(a => {
                let image = new PLRgbImage(a, frame_w, frame_h);
                return image;
            })
        })
    }

    /**
     * Packs a response from endpoints providing raw YCbCr 420 buffer as octet-stream and image size in headers
     * 
     * @param  {Response} response
     * @returns {Promise<PLYCbCrImage>} the image in a promise
     */
    getPLYCbCrImageFromResponse(response) {
        let frame_w = 0
        let frame_h = 0
        if (response.headers.has("image-width")) {
            frame_w = parseInt(response.headers.get("image-width"));
        } else {
            frame_w = this.cameraProps.previewWidth;
        }
        if (response.headers.has("image-height")) {
            frame_h = parseInt(response.headers.get("image-height"));
        } else {
            frame_h = this.cameraProps.previewHeight;
        }
        return response.blob().then(b => {
            return b.arrayBuffer().then(a => {
                let image = new PLYCbCrImage(a, frame_w, frame_h);
                return image;
            })
        })
    }
}
