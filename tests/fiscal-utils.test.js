import { describe, expect, it } from 'vitest';
import {
  SOGLIA_VENDITE_ANNUE,
  calcolaDettaglioRitenuta,
  calcolaImportoTotale,
  calcolaStatoSogliaVendite,
  parseDataItaliana,
  riepilogaAcquistiCliente,
  sommaVenditeAnno
} from '../js/fiscal-utils.js';

describe('fiscal-utils', () => {
  it('calcola il totale da grammi e prezzo/kg', () => {
    expect(calcolaImportoTotale(250, 1200)).toBe(300);
  });

  it('calcola ritenuta e netto sul 78% della base imponibile', () => {
    const dettagli = calcolaDettaglioRitenuta(100);
    expect(dettagli.baseImponibile).toBeCloseTo(78, 5);
    expect(dettagli.ritenuta).toBeCloseTo(17.94, 5);
    expect(dettagli.netto).toBeCloseTo(82.06, 5);
  });

  it('interpreta date italiane valide', () => {
    const data = parseDataItaliana('10/08/2026');
    expect(data).not.toBeNull();
    expect(data.getFullYear()).toBe(2026);
    expect(data.getMonth()).toBe(7);
    expect(data.getDate()).toBe(10);
  });

  it('somma solo le vendite dell\'anno richiesto', () => {
    const storico = [
      { data: '10/01/2026', importo: '150.50' },
      { data: '05/12/2025', importo: '99.99' },
      { data: '22/03/2026', importo: '200' }
    ];

    expect(sommaVenditeAnno(storico, 2026)).toBeCloseTo(350.5, 5);
  });

  it('segnala il superamento della soglia annuale', () => {
    const storico = [
      { data: '10/01/2026', importo: '6800' }
    ];

    const stato = calcolaStatoSogliaVendite(storico, 2026, 250);
    expect(stato.nuovoTotaleAnno).toBe(7050);
    expect(stato.superato).toBe(true);
    expect(stato.quantoManca).toBe(0);
    expect(SOGLIA_VENDITE_ANNUE).toBe(7000);
  });

  it('riepiloga gli acquisti cliente per regime fiscale', () => {
    const storico = [
      { acquirente: 'Cliente Uno', data: '10/01/2026', importo: '100.00', regime: 'sostitutiva' },
      { acquirente: 'cliente uno', data: '15/02/2026', importo: '200.00', regime: 'ritenuta', netto: '164.12', ritenuta: '35.88' },
      { acquirente: 'Cliente Due', data: '20/03/2026', importo: '50.00', regime: 'ritenuta' }
    ];

    const riepilogo = riepilogaAcquistiCliente(storico, 'Cliente Uno');

    expect(riepilogo.totaleAcquisti).toBeCloseTo(300, 5);
    expect(riepilogo.totaleImpostaSostitutiva).toBeCloseTo(100, 5);
    expect(riepilogo.nettoAcquistiImpostaSostitutiva).toBeCloseTo(100, 5);
    expect(riepilogo.totaleRitenutaAcconto).toBeCloseTo(200, 5);
    expect(riepilogo.nettoAcquistiRitenutaAcconto).toBeCloseTo(164.12, 5);
    expect(riepilogo.ritenuteDaVersare).toBeCloseTo(35.88, 5);
    expect(riepilogo.numeroAcquisti).toBe(2);
    expect(riepilogo.dataUltimoAcquisto).toBe('15/02/2026');
  });

  it('calcola il riepilogo cliente anche senza netto e ritenuta salvati', () => {
    const storico = [
      { acquirente: 'Cliente Uno', data: '2026-03-20', importo: '100.00', regime: 'ritenuta' }
    ];

    const riepilogo = riepilogaAcquistiCliente(storico, 'Cliente Uno');

    expect(riepilogo.totaleAcquisti).toBeCloseTo(100, 5);
    expect(riepilogo.nettoAcquistiRitenutaAcconto).toBeCloseTo(82.06, 5);
    expect(riepilogo.ritenuteDaVersare).toBeCloseTo(17.94, 5);
    expect(riepilogo.dataUltimoAcquisto).toBe('2026-03-20');
  });

  it('riepiloga una lista già filtrata anche senza nome cliente', () => {
    const storicoFiltrato = [
      { acquirente: 'Cliente Uno', data: '10/01/2026', importo: '100.00', regime: 'sostitutiva' },
      { acquirente: 'Cliente Uno', data: '15/02/2026', importo: '200.00', regime: 'ritenuta' }
    ];

    const riepilogo = riepilogaAcquistiCliente(storicoFiltrato);

    expect(riepilogo.totaleAcquisti).toBeCloseTo(300, 5);
    expect(riepilogo.numeroAcquisti).toBe(2);
  });
});
