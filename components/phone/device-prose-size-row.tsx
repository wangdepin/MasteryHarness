"use client";

import { CommitInput, SettingsRow } from "@/components/settings/controls";
import { proseSizeFromInput, saveDeviceProseSize, useDeviceProseSize } from "@/components/phone/device-prose-size";
import { useTouchScreen } from "@/components/phone/use-touch-screen";

/**
 * Settings → Appearance, under the shared Reading font size, on a touch
 * screen only: this device's own reading size. Empty follows the shared one.
 */
export function DeviceProseSizeRow({ sharedSize }: { sharedSize: number }) {
	const touch = useTouchScreen();
	const size = useDeviceProseSize();
	if (!touch) return null;
	return (
		<SettingsRow
			label="This device"
			hint={size === null ? `Same as above, ${sharedSize}px` : `${size}px, this device only`}
			testid="row-device-prose-size"
		>
			<CommitInput
				type="number"
				value={size === null ? "" : String(size)}
				placeholder={String(sharedSize)}
				ariaLabel="prose font size on this device"
				testid="input-device-prose-size"
				onCommit={(text) => {
					const next = proseSizeFromInput(text);
					return next !== undefined && saveDeviceProseSize(next);
				}}
			/>
		</SettingsRow>
	);
}
