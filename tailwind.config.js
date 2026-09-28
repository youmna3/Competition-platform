/**
 * iSchool brand theme — https://brand.ischooltech.com
 *   Primary:   Blue #056FEC (60%) · Orange #FF7F1C (30%) · Yellow #FFD700 (10%)
 *   Secondary: Deep blue #043FAD · Sky blue #05ACFF · Ice #F7FAFF
 *   Neutrals:  #FFFFFF #E6EDF1 #B1D1E6 #85A5B9 #597587 #1F2A55
 *   Semantic:  error #FFD1D1/#DE1F1F/#AA1818 · success #BCECCA/#0EAA3A/#0A852D · warning #FCF9E5/#FFBB1C/#B4810B
 *   Type:      Somar Rounded (SemiBold headlines, Medium subheads, Regular body)
 * Tailwind's default scales used across the app are remapped onto the brand
 * palette so every component inherits the identity from one place.
 */
const brand = {
  50: '#EEF6FF', 100: '#D9EBFF', 200: '#B5D7FD', 300: '#7FB8F8', 400: '#3F92F2',
  500: '#1A7EEF', 600: '#056FEC', 700: '#045AD0', 800: '#043FAD', 900: '#0A3185', 950: '#1F2A55',
};
const neutral = {
  50: '#F7FAFF', 100: '#EEF3F8', 200: '#E6EDF1', 300: '#B1D1E6', 400: '#85A5B9',
  500: '#597587', 600: '#4B6477', 700: '#384E66', 800: '#2A3A5E', 900: '#1F2A55', 950: '#151D3D',
};
const orange = {
  50: '#FFF7F0', 100: '#FFEFE3', 200: '#FFD9BD', 300: '#FFB57A', 400: '#FF9A4D',
  500: '#FF7F1C', 600: '#F56A00', 700: '#C95500', 800: '#9E4300', 900: '#7A3400', 950: '#4A1F00',
};
const yellow = {
  50: '#FCF9E5', 100: '#FFF3C2', 200: '#FFE78A', 300: '#FFD700', 400: '#FFC933',
  500: '#FFBB1C', 600: '#E0A00F', 700: '#B4810B', 800: '#8A620A', 900: '#664808', 950: '#3D2B05',
};
const success = {
  50: '#EDFAF1', 100: '#BCECCA', 200: '#94DFAB', 300: '#5ECF81', 400: '#2FBD5B',
  500: '#0EAA3A', 600: '#0C9733', 700: '#0A852D', 800: '#086A24', 900: '#06511C', 950: '#033010',
};
const error = {
  50: '#FFF1F1', 100: '#FFD1D1', 200: '#FFB3B3', 300: '#F58585', 400: '#EC5252',
  500: '#DE1F1F', 600: '#C51B1B', 700: '#AA1818', 800: '#861313', 900: '#660F0F', 950: '#3D0909',
};
const sky = {
  50: '#ECF8FF', 100: '#D2EEFF', 200: '#A6DDFF', 300: '#5CC9FF', 400: '#05ACFF',
  500: '#056FEC', 600: '#0459D0', 700: '#043FAD', 800: '#0A3185', 900: '#1F2A55', 950: '#151D3D',
};

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Somar Rounded"', 'Nunito', 'ui-rounded', 'system-ui', 'sans-serif'],
      },
      colors: {
        brand,
        slate: neutral,
        orange,
        amber: yellow,
        emerald: success,
        rose: error,
        // competition identities (within the brand palette)
        demi: orange, // DEMI = iSchool orange
        deci: sky,    // DECI = iSchool blue family
        ischool: { blue: '#056FEC', orange: '#FF7F1C', yellow: '#FFD700', navy: '#1F2A55', deep: '#043FAD', sky: '#05ACFF', ice: '#F7FAFF' },
      },
      boxShadow: {
        card: '0 1px 2px rgba(31,42,85,.04), 0 2px 8px rgba(5,111,236,.06)',
        pop: '0 8px 24px rgba(5,111,236,.18)',
      },
    },
  },
  plugins: [],
};
