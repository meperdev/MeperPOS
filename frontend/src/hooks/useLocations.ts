"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { LocationSite, LocationType } from "@/types";

/** Every surface that lists or labels sites reads this key. */
export const LOCATIONS_QUERY_KEY = ["locations"] as const;
/**
 * The POS eligibility query is keyed per user and organization
 * (`usePosSiteContext`), so it is invalidated by prefix: adding, renaming or
 * reassigning a site changes which site may charge.
 */
export const POS_SITE_CONTEXT_QUERY_KEY = ["pos-site-context"] as const;
export const userLocationsQueryKey = (userId: string) =>
  ["user-locations", userId] as const;

export interface LocationPayload {
  name: string;
  type: LocationType;
  /** Trimmed by the API; an empty value clears the stored field. */
  address?: string | null;
  phone?: string | null;
}

export interface UpdateLocationPayload {
  id: string;
  data: Partial<LocationPayload>;
}

export interface ReplaceAssignmentsPayload {
  userId: string;
  locationIds: string[];
}

/** What one membership can reach: explicit rows plus a role that bypasses them. */
export interface UserLocationAssignments {
  locationIds: string[];
  /** Owners and administrators reach every site through their role. */
  orgWideAccess: boolean;
}

function createLocationRequest(data: LocationPayload) {
  return api.post<LocationSite>("/locations", data);
}

function getLocationsRequest() {
  return api.get<LocationSite[]>("/locations");
}

function updateLocationRequest({ id, data }: UpdateLocationPayload) {
  return api.patch<LocationSite>(`/locations/${encodeURIComponent(id)}`, data);
}

function userLocationsRequest(userId: string) {
  return api.get<UserLocationAssignments>(
    `/users/${encodeURIComponent(userId)}/locations`,
  );
}

function replaceAssignmentsRequest({
  userId,
  locationIds,
}: ReplaceAssignmentsPayload) {
  return api.put<{ locationIds: string[] }>(
    `/users/${encodeURIComponent(userId)}/locations`,
    { locationIds },
  );
}

/** The sites the caller may see: every site for owners and administrators. */
export function useLocations() {
  return useQuery({
    queryKey: LOCATIONS_QUERY_KEY,
    queryFn: () => getLocationsRequest().then(({ data }) => data),
  });
}

export function useCreateLocation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: LocationPayload) =>
      createLocationRequest(data).then((res) => res.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: LOCATIONS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: POS_SITE_CONTEXT_QUERY_KEY });
    },
  });
}

export function useUpdateLocation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: UpdateLocationPayload) =>
      updateLocationRequest(payload).then((res) => res.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: LOCATIONS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: POS_SITE_CONTEXT_QUERY_KEY });
    },
  });
}

/**
 * The access of one membership: the explicit assignment rows plus whether the
 * role already reaches every site. Owners and administrators hold no rows, so
 * the flag is what tells the dialog not to offer checkboxes.
 */
export function useUserLocationAssignments(userId: string | null) {
  return useQuery({
    queryKey: userLocationsQueryKey(userId ?? "none"),
    queryFn: () => userLocationsRequest(userId as string).then(({ data }) => data),
    enabled: Boolean(userId),
  });
}

export function useReplaceLocationAssignments() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: ReplaceAssignmentsPayload) =>
      replaceAssignmentsRequest(payload).then((res) => res.data),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: LOCATIONS_QUERY_KEY });
      void queryClient.invalidateQueries({
        queryKey: userLocationsQueryKey(variables.userId),
      });
      void queryClient.invalidateQueries({ queryKey: POS_SITE_CONTEXT_QUERY_KEY });
    },
  });
}
