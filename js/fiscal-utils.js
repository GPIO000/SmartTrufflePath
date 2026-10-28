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

export function getNextLottoNumber(storicoVendite = [], dataEmissione = new Date(), progressivoSalvato = 0) {
    const data = dataEmissione instanceof Date ? dataEmissione : new Date(dataEmissione);
    if (Number.isNaN(data.getTime())) throw new TypeError('Data di emissione non valida.');

    const anno = data.getFullYear();
    let ricevuteNellAnno = 0;
    let progressivoMassimo = Number.isFinite(Number(progressivoSalvato)) ? Math.max(0, Number(progressivoSalvato)) : 0;

    for (const vendita of storicoVendite) {
        const dataVendita = parseDataVendita(vendita && vendita.data ? vendita.data : '');
        if (!dataVendita || dataVendita.getFullYear() !== anno) continue;

        ricevuteNellAnno += 1;
        const lottoMatch = String(vendita.lotto || '').match(/^LOTTO-(\d{4})\d{4}-(\d+)$/);
        if (lottoMatch && Number(lottoMatch[1]) === anno) {
            progressivoMassimo = Math.max(progressivoMassimo, Number(lottoMatch[2]));
        }
    }

    const progressivo = Math.max(ricevuteNellAnno, progressivoMassimo) + 1;
    const dataLotto = [
        String(anno).padStart(4, '0'),
        String(data.getMonth() + 1).padStart(2, '0'),
        String(data.getDate()).padStart(2, '0')
    ].join('');

    return `LOTTO-${dataLotto}-${String(progressivo).padStart(2, '0')}`;
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
            const dettagliSalvati = nettoSalvato && ritenutaSalvata;
            const dettagliRitenuta = dettagliSalvati ? null : calcolaDettaglioRitenuta(importoLordo);
            riepilogo.totaleRitenutaAcconto += importoLordo;
            riepilogo.nettoAcquistiRitenutaAcconto += dettagliSalvati
                ? parseFloat(vendita.netto) || 0
                : dettagliRitenuta.netto;
            riepilogo.ritenuteDaVersare += dettagliSalvati
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
