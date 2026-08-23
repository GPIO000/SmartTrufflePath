import { describe, expect, it } from 'vitest';
import {
    aggregateHourlyToDaily,
    buildTruffleForecastCalendar,
    getOpenSpeciesForRegion,
    getFeedbackClassesForSpecies,
    isDateWithinPeriod
} from '../js/truffle-forecast.js';

function makeSeries(startDate, days, overrides = {}) {
    const baseDate = new Date(`${startDate}T12:00:00`);
    return Array.from({ length: days }, (_, index) => {
        const current = new Date(baseDate);
        current.setDate(baseDate.getDate() + index);
        const date = current.toISOString().slice(0, 10);
        return {
            date,
            temperatureMean: 14,
            temperatureMin: 10,
            temperatureMax: 18,
            temperatureSwing: 8,
            humidityMean: 76,
            precipitationSum: index >= 7 && index <= 11 ? 4.5 : 1.2,
            windMax: 16,
            soilMoistureMean: 0.29,
            ...(typeof overrides === 'function' ? overrides(index, date) : overrides)
        };
    });
}

describe('aggregateHourlyToDaily', () => {
    it('raggruppa i dati orari per giorno', () => {
        const daily = aggregateHourlyToDaily({
            time: [
                '2026-09-01T00:00',
                '2026-09-01T01:00',
                '2026-09-02T00:00'
            ],
            temperature_2m: [10, 14, 20],
            relative_humidity_2m: [70, 74, 60],
            precipitation: [0.4, 0.6, 1.5],
            wind_speed_10m: [12, 18, 9],
            soil_moisture_0_to_1cm: [0.22, 0.24, 0.18]
        });

        expect(daily).toHaveLength(2);
        expect(daily[0]).toMatchObject({
            date: '2026-09-01',
            temperatureMean: 12,
            temperatureMin: 10,
            temperatureMax: 14,
            precipitationSum: 1,
            windMax: 18,
            soilMoistureMean: 0.23
        });
    });
});

describe('isDateWithinPeriod', () => {
    it('riconosce periodi nello stesso anno', () => {
        expect(isDateWithinPeriod('1 ottobre - 31 dicembre', new Date('2026-11-05T12:00:00'))).toBe(true);
        expect(isDateWithinPeriod('1 ottobre - 31 dicembre', new Date('2026-09-20T12:00:00'))).toBe(false);
    });

    it('gestisce periodi a cavallo d\'anno', () => {
        expect(isDateWithinPeriod('15 novembre - 31 gennaio', new Date('2026-12-20T12:00:00'))).toBe(true);
        expect(isDateWithinPeriod('15 novembre - 31 gennaio', new Date('2027-01-10T12:00:00'))).toBe(true);
        expect(isDateWithinPeriod('15 novembre - 31 gennaio', new Date('2027-03-10T12:00:00'))).toBe(false);
    });
});

describe('getOpenSpeciesForRegion', () => {
    it('restituisce solo le specie aperte alla data indicata', () => {
        const openSpecies = getOpenSpeciesForRegion({
            0: '1 ottobre - 31 dicembre',
            1: '1 gennaio - 31 gennaio',
            5: '15 giugno - 31 agosto'
        }, new Date('2026-10-15T12:00:00'));

        expect(openSpecies.map((species) => species.id)).toEqual([0]);
    });

    it('ignora calendari mancanti o non validi', () => {
        expect(getOpenSpeciesForRegion(null, new Date('2026-10-15T12:00:00'))).toEqual([]);
        expect(getOpenSpeciesForRegion([], new Date('2026-10-15T12:00:00'))).toEqual([]);
    });
});

describe('buildTruffleForecastCalendar', () => {
    it('produce punteggi alti in condizioni favorevoli', () => {
        const series = makeSeries('2026-10-01', 21);
        const forecast = buildTruffleForecastCalendar({
            speciesId: 0,
            legalPeriod: '1 ottobre - 31 dicembre',
            weatherSeries: series,
            locationLabel: 'Bosco Nord',
            harvestHistory: [
                { data: '2025-10-15', specie: 'Tuber magnatum Pico (Tartufo bianco pregiato)', luogo: 'Bosco Nord' }
            ],
            feedbackHistory: [
                { date: '2025-10-20', speciesName: 'Tuber magnatum Pico (Tartufo bianco pregiato)', locationLabel: 'Bosco Nord', found: true }
            ],
            referenceDate: new Date('2026-10-15T12:00:00'),
            forecastDays: 3
        });

        expect(forecast.days).toHaveLength(3);
        expect(forecast.days[0].legalOpen).toBe(true);
        expect(forecast.days[0].score).toBeGreaterThanOrEqual(70);
        expect(forecast.days[0].reasons.join(' ')).toContain('Suolo umido');
    });

    it('azzera i giorni fuori calendario regionale', () => {
        const series = makeSeries('2026-06-01', 21);
        const forecast = buildTruffleForecastCalendar({
            speciesId: 0,
            legalPeriod: '1 ottobre - 31 dicembre',
            weatherSeries: series,
            locationLabel: 'Bosco Nord',
            referenceDate: new Date('2026-06-15T12:00:00'),
            forecastDays: 2
        });

        expect(forecast.days[0]).toMatchObject({
            legalOpen: false,
            score: 0,
            level: 'bassa'
        });
    });

    it('penalizza siccità, vento e feedback negativi', () => {
        const series = makeSeries('2026-10-01', 21, (index) => ({
            precipitationSum: index >= 16 ? 0 : 0.2,
            windMax: 38,
            humidityMean: 42,
            soilMoistureMean: 0.1,
            temperatureMean: 24,
            temperatureMin: 18,
            temperatureMax: 30,
            temperatureSwing: 12
        }));
        const forecast = buildTruffleForecastCalendar({
            speciesId: 1,
            legalPeriod: '1 ottobre - 31 dicembre',
            weatherSeries: series,
            locationLabel: 'Punto Sud',
            feedbackHistory: [
                { date: '2025-10-14', speciesName: 'Tuber melanosporum Vitt. (Tartufo nero di Norcia)', locationLabel: 'Punto Sud', found: false }
            ],
            referenceDate: new Date('2026-10-15T12:00:00'),
            forecastDays: 1
        });

        expect(forecast.days[0].score).toBeLessThan(40);
        expect(forecast.days[0].reasons.join(' ')).toContain('Terreno secco');
    });

    it('espone soglie feedback dedicate per magnatum e default per altre specie', () => {
        const magnatum = getFeedbackClassesForSpecies(0);
        const scorzone = getFeedbackClassesForSpecies(5);

        expect(magnatum.map((entry) => entry.id)).toEqual([
            'none',
            'lt100',
            'gte100_lt300',
            'gte300'
        ]);
        expect(scorzone.map((entry) => entry.id)).toEqual([
            'none',
            'lt500',
            'gte500'
        ]);
    });

    it('assegna più peso ai feedback classe alta e mantiene compatibilità con found legacy', () => {
        const series = makeSeries('2026-10-01', 21);
        const baseArgs = {
            speciesId: 1,
            legalPeriod: '1 ottobre - 31 dicembre',
            weatherSeries: series,
            locationLabel: 'Bosco Test',
            referenceDate: new Date('2026-10-15T12:00:00'),
            forecastDays: 1
        };

        const withLowClass = buildTruffleForecastCalendar({
            ...baseArgs,
            feedbackHistory: [
                { date: '2025-10-18', speciesName: 'Tuber melanosporum Vitt. (Tartufo nero di Norcia)', locationLabel: 'Bosco Test', outcomeClassId: 'lt500' }
            ]
        });
        const withHighClass = buildTruffleForecastCalendar({
            ...baseArgs,
            feedbackHistory: [
                { date: '2025-10-18', speciesName: 'Tuber melanosporum Vitt. (Tartufo nero di Norcia)', locationLabel: 'Bosco Test', outcomeClassId: 'gte500' }
            ]
        });
        const withLegacyPositive = buildTruffleForecastCalendar({
            ...baseArgs,
            feedbackHistory: [
                { date: '2025-10-18', speciesName: 'Tuber melanosporum Vitt. (Tartufo nero di Norcia)', locationLabel: 'Bosco Test', found: true }
            ]
        });

        expect(withHighClass.days[0].score).toBeGreaterThan(withLowClass.days[0].score);
        expect(withLegacyPositive.days[0].score).toBeGreaterThanOrEqual(withLowClass.days[0].score);
    });
});
