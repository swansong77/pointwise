'use client';

import { BrandLogo } from '@/components/brand-logo';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Button, EmptyState, ErrorText, Panel, PageHeader, Select, Spinner } from '@/components/ui';
import { WalletCardArt } from '@/components/card-bits';
import { useNearby } from '@/lib/queries';
import { centsPerDollar, distance, money } from '@/lib/format';

/** Demo location used when geolocation is unavailable (matches the seeded locations). */
const DEMO_LOCATION = { lat: 37.7749, lng: -122.4194 };

export default function NearbyPage() {
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [radius, setRadius] = useState(1500);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const nearby = useNearby(coords, radius);

  function locate() {
    setGeoError(null);
    if (!('geolocation' in navigator)) {
      setGeoError('Location is not available in this browser.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        setCoords({ lat: p.coords.latitude, lng: p.coords.longitude });
      },
      (err) => {
        setLocating(false);
        setGeoError(err.code === err.PERMISSION_DENIED ? 'Location permission denied. You can use the demo location instead.' : 'Could not get your location.');
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Nearby" subtitle="Stores around you and the best card to use at each. Your location is never stored." />
      <Panel>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={locate} loading={locating}>
            📍 Use my location
          </Button>
          <Button variant="secondary" onClick={() => setCoords(DEMO_LOCATION)} data-testid="demo-location">
            Use demo location
          </Button>
          <label className="ml-auto flex items-center gap-2 text-sm text-slate-600">
            Radius
            <Select value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="w-28">
              <option value={500}>500 m</option>
              <option value={1500}>1.5 km</option>
              <option value={5000}>5 km</option>
              <option value={25000}>25 km</option>
            </Select>
          </label>
        </div>
        {geoError && <p className="mt-3 text-sm text-amber-700">{geoError}</p>}
      </Panel>
      {!coords && <EmptyState title="Choose a location">Share your location or use the demo location to see nearby stores.</EmptyState>}
      {nearby.isLoading && <Spinner label="Finding stores" />}
      <ErrorText error={nearby.error} />
      {nearby.data?.length === 0 && <EmptyState title="No stores found nearby">Try a larger radius.</EmptyState>}
      <ul className="space-y-3" data-testid="nearby-list">
        {nearby.data?.map((n) => (
          <li key={n.locationId} className="rounded-2xl border border-slate-200 bg-white p-4" data-testid="nearby-item">
            <div className="flex flex-wrap items-center gap-3">
              <BrandLogo brand={{ slug: n.merchant.slug, name: n.merchant.name ?? n.name }} name={n.name} size="lg" />
              <div className="min-w-0 flex-1">
                <Link href={`/merchants/${n.merchant.slug}`} className="font-medium text-slate-900 hover:underline">
                  {n.name}
                </Link>
                <p className="text-xs text-slate-500">
                  {n.merchant.category} · {distance(n.distanceM)} {n.address && `· ${n.address}`}
                </p>
              </div>
              {n.bestCard ? (
                <div className="flex items-center gap-2 text-right">
                  <WalletCardArt walletCardId={n.bestCard.walletCardId} cardId={n.bestCard.cardId} name={n.bestCard.name} color={n.bestCard.color} />
                  <div>
                    <p className="text-sm font-semibold">{n.bestCard.name}</p>
                    <p className="text-xs text-slate-500">{centsPerDollar(n.bestCard.centsPerDollar)}</p>
                  </div>
                </div>
              ) : (
                <Badge>Add cards to see your best card</Badge>
              )}
            </div>
            {n.offers.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-2">
                {n.offers.map((o) => (
                  <li key={o.id}>
                    <Badge tone="green">
                      🏷️ {o.title} ({money(o.valueCents)})
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
