import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Logo, LogoMark } from '../src/components/logo';

describe('PointWise logo', () => {
  it('the logo keeps the name as real text', () => {
    render(<Logo size="sm" />);
    expect(screen.getByTestId('logo')).toHaveTextContent('PointWise');
    expect(screen.getByTestId('logo-mark')).toHaveAttribute('aria-hidden', 'true');
  });
  it('a stand-alone mark is named for screen readers', () => {
    render(<LogoMark size="xl" title="PointWise" />);
    const m = screen.getByRole('img', { name: 'PointWise' });
    expect(m).toHaveAttribute('width', '80');
  });
  it('light tone is for dark backgrounds', () => {
    render(<Logo tone="light" />);
    expect(screen.getByTestId('logo').innerHTML).toContain('text-white');
  });
  it('the component and the SVG files draw the same mark', () => {
    const svg = readFileSync(join(__dirname, '../public/logo/pointwise-mark.svg'), 'utf8');
    const path = /d="(M17 11[^"]+)"/.exec(svg)![1];
    render(<LogoMark />);
    expect(screen.getByTestId('logo-mark').innerHTML.replace(/&amp;/g, '&')).toContain(path);
    expect(readFileSync(join(__dirname, '../src/app/icon.svg'), 'utf8')).toBe(svg);
    expect(svg).not.toMatch(/script|href|<image|<style/i);
  });
});
