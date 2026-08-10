export const RITENUTA_ALIQUOTA = 0.23;
export const RITENUTA_BASE_IMPONIBILE = 0.78;
export const SOGLIA_VENDITE_ANNUE = 7000;

export function calcolaImportoTotale(grammi, prezzoKg) {
    const peso = Number(grammi) || 0;
    const prezzo = Number(prezzoKg) || 0;
    return (peso / 1000) * prezzo;
}

export function calcolaDettaglioRitenuta(importoTotale) {
    const importo = Number(importoTotale) || 0;
    const baseImponibile = importo * RITENUTA_BASE_IMPONIBILE;
    const ritenuta = baseImponibile * RITENUTA_ALIQUOTA;
    const netto = importo - ritenuta;
    return { baseImponibile, ritenuta, netto };
}

export function parseDataItaliana(dataStringa) {
    if (typeof dataStringa !== 'string' || !/^\d{2}\/\d{2}\/\d{4}$/.test(dataStringa)) return null;
    const [giorno, mese, anno] = dataStringa.split('/').map(Number);
    const data = new Date(anno, mese - 1, giorno);
    return Number.isNaN(data.getTime()) ? null : data;
}

export function sommaVenditeAnno(storicoVendite = [], annoCorrente = new Date().getFullYear()) {
    return storicoVendite.reduce((totale, voce) => {
        const dataVendita = parseDataItaliana(voce && voce.data ? voce.data : '') || new Date();
        return dataVendita.getFullYear() === annoCorrente
            ? totale + (parseFloat(voce && voce.importo) || 0)
            : totale;
    }, 0);
}

export function calcolaStatoSogliaVendite(storicoVendite = [], annoCorrente = new Date().getFullYear(), nuovoImporto = 0) {
    const totaleVenditeAnno = sommaVenditeAnno(storicoVendite, annoCorrente);
    const incremento = Number(nuovoImporto) || 0;
    const nuovoTotaleAnno = totaleVenditeAnno + incremento;
    return {
        totaleVenditeAnno,
        nuovoTotaleAnno,
        quantoManca: Math.max(0, SOGLIA_VENDITE_ANNUE - nuovoTotaleAnno),
        superato: nuovoTotaleAnno > SOGLIA_VENDITE_ANNUE
    };
}
