export const W = 400;
export const TS = 18;
export const H2 = 9;
export const OX = 200, OY = 212;
export const q = 2;

export const cx = c => OX + c * TS;
export const cy = r => OY + r * TS;

export const LAND_C_MAX = 6;
export const LAND_R_MIN = -4;
export const LAND_R_MAX = 4;
export const TOWER_MAX_H = 6;
export const TOWER_RAISE_RATE = 0.5;
export const CITIZEN_SPEED = 0.35;

export const COL = {
  courage:   '#FFB454',
  vitality:  '#79C8FF',
  curiosity: '#B08CFF',
  warmth:    '#FF8A6B',
  focus:     '#6E9BFF',
};

export const LAND_TOP   = '#34715f';
export const LAND_HI    = '#498c76';
export const LAND_EDGE  = '#24514a';
export const LAND_SOIL  = '#3a2c22';
export const SKY_BG     = '#070a14';

// Citizen palette options
export const CITIZEN_PALS = ['#FFB454','#79C8FF','#B08CFF','#FF8A6B','#6E9BFF','#f0c0ff','#ffef99'];
