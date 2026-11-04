const FRAME_MODELS = [
  { id: "seat-frame-standard", code: "RSP-STD", name: "Rám sedadla – štandard", family: "Štandardný rám", parts: ["Bočný oblúk ľavý", "Bočný oblúk pravý", "Horný priečnik", "Dolný priečnik", "Predná výstuha", "Zadná výstuha", "Drôt operadla ľavý", "Drôt operadla pravý", "Sedacia výstuha ľavá", "Sedacia výstuha pravá", "Držiak pásu ľavý", "Držiak pásu pravý", "Spojovací oblúk", "Bočná výstuž ľavá", "Bočná výstuž pravá"] },
  { id: "seat-frame-comfort", code: "RSP-CMF", name: "Rám sedadla – Comfort", family: "Komfortný rám", parts: ["Bočný oblúk ľavý Comfort", "Bočný oblúk pravý Comfort", "Horný priečnik Comfort", "Dolný priečnik Comfort", "Predná výstuha Comfort", "Zadná výstuha Comfort", "Drôt operadla ľavý Comfort", "Drôt operadla pravý Comfort", "Sedacia výstuha ľavá Comfort", "Sedacia výstuha pravá Comfort", "Držiak pásu ľavý Comfort", "Držiak pásu pravý Comfort", "Spojovací oblúk Comfort", "Bočná výstuž ľavá Comfort", "Bočná výstuž pravá Comfort"] },
  { id: "seat-frame-sport", code: "RSP-SPT", name: "Rám sedadla – Sport", family: "Športový rám", parts: ["Bočný oblúk ľavý Sport", "Bočný oblúk pravý Sport", "Horný priečnik Sport", "Dolný priečnik Sport", "Predná výstuha Sport", "Zadná výstuha Sport", "Drôt operadla ľavý Sport", "Drôt operadla pravý Sport", "Sedacia výstuha ľavá Sport", "Sedacia výstuha pravá Sport", "Držiak pásu ľavý Sport", "Držiak pásu pravý Sport", "Spojovací oblúk Sport", "Bočná výstuž ľavá Sport", "Bočná výstuž pravá Sport"] },
  { id: "seat-frame-rear", code: "RSP-RR", name: "Rám zadného sedadla", family: "Zadný rám", parts: ["Bočný oblúk ľavý zadný", "Bočný oblúk pravý zadný", "Horný priečnik zadný", "Dolný priečnik zadný", "Predná výstuha zadná", "Zadná výstuha zadná", "Drôt operadla ľavý zadný", "Drôt operadla pravý zadný", "Sedacia výstuha ľavá zadná", "Sedacia výstuha pravá zadná", "Držiak pásu ľavý zadný", "Držiak pásu pravý zadný", "Spojovací oblúk zadný", "Bočná výstuž ľavá zadná", "Bočná výstuž pravá zadná"] }
];

const padded = (value) => String(value).padStart(2, "0");

const SCHERDEL_PRODUCT_CATALOG = FRAME_MODELS.flatMap((model) => {
  const weldId = `${model.id}-welded`;
  const qcId = `${model.id}-qc`;
  const outputId = `${model.id}-output`;
  const blanks = model.parts.map((part, index) => ({
    id: `${model.id}-blank-${padded(index + 1)}`,
    itemCode: `${model.code}-P${padded(index + 1)}`,
    itemName: `${part} – ohnutý polotovar`,
    operation: "Ohýbanie drôtu",
    defaultQuantity: 250,
    cycleTimeSec: 18 + (index % 5) * 3,
    setupMinutes: 20,
    feedsIntoProductIds: [weldId],
    frameModelId: model.id,
    sequence: index + 1
  }));

  return [
    ...blanks,
    { id: weldId, itemCode: model.code, itemName: model.name, operation: "Zváranie rámu", defaultQuantity: 250, cycleTimeSec: 75, setupMinutes: 35, feedsIntoProductIds: [qcId], frameModelId: model.id, productStage: "welding" },
    { id: qcId, itemCode: `${model.code}-QC`, itemName: `${model.name} – skontrolovaný`, operation: "Kontrola kvality", defaultQuantity: 250, cycleTimeSec: 24, setupMinutes: 10, feedsIntoProductIds: [outputId], frameModelId: model.id, productStage: "quality" },
    { id: outputId, itemCode: `${model.code}-OUT`, itemName: `${model.name} – výstup`, operation: "Výstup / expedícia", defaultQuantity: 250, cycleTimeSec: 12, setupMinutes: 5, feedsIntoProductIds: [], frameModelId: model.id, productStage: "output" }
  ];
});

export { FRAME_MODELS, SCHERDEL_PRODUCT_CATALOG };
