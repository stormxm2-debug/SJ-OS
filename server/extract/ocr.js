import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWorker } from "tesseract.js";

// 한국어/영어 인식 모델(문서 내용이 아닌 공개 언어 모델)은 최초 1회만 내려받아 이 폴더에 보관한다.
const CACHE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".cache", "tesseract");

// OCR 워커는 초기화 비용이 크므로 프로세스 내에서 하나만 재사용한다.
// 이미지/문서 내용은 외부로 전송되지 않고 이 프로세스 안(WASM)에서만 처리된다.
let workerPromise = null;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker("kor+eng", 1, {
      cachePath: CACHE_DIR,
      logger: () => {}, // 문서 내용이 로그에 남지 않도록 진행 로그를 끈다.
    });
  }
  return workerPromise;
}

// 이미지 버퍼를 OCR로 인식하여 단어 단위 아이템(텍스트+좌표+신뢰도)을 반환한다.
export async function ocrImageBuffer(buffer) {
  const worker = await getWorker();
  const { data } = await worker.recognize(buffer);

  const items = (data.words || [])
    // 표 선이 "_", "|", "ㅣ" 같은 글자로 잘못 인식되어 숫자 끝에 붙는 경우("300ㅣ")를 떼어낸다.
    .map((w) => ({ ...w, text: (w.text || "").trim().replace(/^[|ㅣ｜丨]+|[|ㅣ｜丨]+$/g, "") }))
    .filter((w) => w.text.length > 0)
    .filter((w) => !/^[_|~=\-—–]+$/.test(w.text))
    // 신뢰도가 거의 0인 한두 글자짜리 기호/영문은 표 선이나 얼룩으로 보고 버린다.
    .filter((w) => !(w.confidence < 15 && /^[^가-힣]{1,2}$/.test(w.text)))
    .map((w) => ({
      str: w.text,
      x: w.bbox.x0,
      // 줄 묶음은 글자 상자의 세로 중심으로 판단한다(일부 글자 상자가 두 줄 높이로 크게 잡혀도 제 줄에 붙도록).
      y: (w.bbox.y0 + w.bbox.y1) / 2,
      width: w.bbox.x1 - w.bbox.x0,
      height: w.bbox.y1 - w.bbox.y0,
      confidence: w.confidence, // 0~100
      ocr: true,
    }));

  return items;
}

export async function terminateOcr() {
  if (workerPromise) {
    const worker = await workerPromise;
    workerPromise = null;
    await worker.terminate();
  }
}
