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

function parseDataVendita(dataStringa) {
    if (typeof dataStringa !== 'string' || !dataStringa.trim()) return null;
    if (dataStringa.includes('/')) return parseDataItaliana(dataStringa);
    const data = new Date(dataStringa);
    return Number.isNaN(data.getTime()) ? null : data;
}

export function riepilogaAcquistiCliente(storicoVendite = [], nomeCliente = '') {
    const nomeClienteNormalizzato = String(nomeCliente || '').trim().toLowerCase();
    const filtraPerCliente = Boolean(nomeClienteNormalizzato);
    const riepilogo = {
        totaleAcquisti: 0,
        totaleImpostaSostitutiva: 0,
        nettoAcquistiImpostaSostitutiva: 0,
        totaleRitenutaAcconto: 0,
        nettoAcquistiRitenutaAcconto: 0,
        ritenuteDaVersare: 0,
        numeroAcquisti: 0,
        dataUltimoAcquisto: ''
    };

    let timestampUltimoAcquisto = null;

    storicoVendite.forEach((vendita) => {
        const nomeAcquirente = String(vendita && vendita.acquirente ? vendita.acquirente : '').trim().toLowerCase();
        if (filtraPerCliente && nomeAcquirente !== nomeClienteNormalizzato) return;

        const importoLordo = parseFloat(vendita && vendita.importo) || 0;
        const regime = vendita && vendita.regime ? vendita.regime : 'sostitutiva';
        riepilogo.totaleAcquisti += importoLordo;
        riepilogo.numeroAcquisti += 1;

        if (regime === 'ritenuta') {
            const nettoSalvato = vendita && vendita.netto !== undefined;
            const ritenutaSalvata = vendita && vendita.ritenuta !== undefined;
            const dettagliRitenuta = nettoSalvato && ritenutaSalvata ? null : calcolaDettaglioRitenuta(importoLordo);
            riepilogo.totaleRitenutaAcconto += importoLordo;
            riepilogo.nettoAcquistiRitenutaAcconto += nettoSalvato && ritenutaSalvata
                ? parseFloat(vendita.netto) || 0
                : dettagliRitenuta.netto;
            riepilogo.ritenuteDaVersare += nettoSalvato && ritenutaSalvata
                ? parseFloat(vendita.ritenuta) || 0
                : dettagliRitenuta.ritenuta;
        } else {
            riepilogo.totaleImpostaSostitutiva += importoLordo;
            riepilogo.nettoAcquistiImpostaSostitutiva += importoLordo;
        }

        const dataVendita = parseDataVendita(vendita && vendita.data ? vendita.data : '');
        if (!dataVendita) return;

        const timestampVendita = dataVendita.getTime();
        if (timestampUltimoAcquisto === null || timestampVendita > timestampUltimoAcquisto) {
            timestampUltimoAcquisto = timestampVendita;
            riepilogo.dataUltimoAcquisto = vendita.data;
        }
    });

    return riepilogo;
}
