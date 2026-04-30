// BF's Agentic Response Validator - Profile Switching Module
// Handles connection profile management for validator agent
// Profile switching is OPTIONAL - only used when useValidatorProfile is enabled

/** @returns {object} SillyTavern context */
function getContext() {
    return SillyTavern.getContext();
}

/** @returns {object} Extension settings from SillyTavern */
function getExtensionSettings() {
    return getContext().extensionSettings;
}

/**
 * Get list of available connection profiles
 * @returns {Array} Array of profile objects with id and name
 */
export function getConnectionProfiles() {
    try {
        const profiles = getExtensionSettings()?.connectionManager?.profiles;
        if (Array.isArray(profiles)) {
            return profiles;
        }
        return [];
    } catch (error) {
        console.error('[BFValidator] Error getting profiles:', error);
        return [];
    }
}

/**
 * Get current active profile ID
 * @returns {string|null} Current profile ID or null
 */
export function getCurrentProfileId() {
    try {
        return getExtensionSettings()?.connectionManager?.selectedProfile || null;
    } catch (error) {
        console.error('[BFValidator] Error getting current profile:', error);
        return null;
    }
}

/**
 * Get profile by ID
 * @param {string} profileId - Profile ID to look up
 * @returns {object|null} Profile object or null if not found
 */
export function getProfileById(profileId) {
    const profiles = getConnectionProfiles();
    return profiles.find(p => p.id === profileId) || null;
}

/**
 * Switch to a different connection profile
 * @param {string} targetId - Target profile ID to switch to
 * @returns {Promise<string|false>} Previous profile ID if switched, false if failed or already on target
 */
export async function swapProfile(targetId) {
    try {
        const current = getExtensionSettings()?.connectionManager?.selectedProfile;
        const profiles = getExtensionSettings()?.connectionManager?.profiles;

        // Already on target profile
        if (current === targetId) {
            console.log('[BFValidator] Already on target profile:', targetId);
            return false;
        }

        // Validate target profile exists
        if (!Array.isArray(profiles) || profiles.findIndex(p => p.id === targetId) < 0) {
            console.error('[BFValidator] Invalid profile ID:', targetId);
            toastr.error('Invalid connection profile for validator', 'BF Validator');
            return false;
        }

        console.log('[BFValidator] Swapping from profile', current, 'to', targetId);

        // Update the dropdown and trigger change event
        const dropdown = document.getElementById('connection_profiles');
        if (!dropdown) {
            console.error('[BFValidator] Connection profiles dropdown not found');
            return false;
        }

        $('#connection_profiles').val(targetId);
        dropdown.dispatchEvent(new Event('change'));

        // Wait for profile to be loaded
        await new Promise((resolve) => {
            getContext().eventSource.once(
                getContext().eventTypes.CONNECTION_PROFILE_LOADED,
                resolve
            );
        });

        console.log('[BFValidator] Profile swap complete, previous:', current);
        return current;
    } catch (error) {
        console.error('[BFValidator] Error swapping profile:', error);
        return false;
    }
}

/**
 * Restore a previously saved profile
 * @param {string} profileId - Profile ID to restore
 * @returns {Promise<boolean>} True if restored successfully
 */
export async function restoreProfile(profileId) {
    if (!profileId) {
        console.log('[BFValidator] No profile to restore');
        return false;
    }

    try {
        const dropdown = document.getElementById('connection_profiles');
        if (!dropdown) {
            console.error('[BFValidator] Connection profiles dropdown not found');
            return false;
        }

        console.log('[BFValidator] Restoring profile:', profileId);

        // Set the dropdown value
        $('#connection_profiles').val(profileId);

        // Create a promise that resolves on profile load OR timeout
        const loadPromise = new Promise((resolve) => {
            const timeout = setTimeout(() => {
                console.log('[BFValidator] Profile load timeout, continuing anyway');
                resolve();
            }, 3000); // 3 second timeout

            getContext().eventSource.once(
                getContext().eventTypes.CONNECTION_PROFILE_LOADED,
                () => {
                    clearTimeout(timeout);
                    resolve();
                }
            );
        });

        // Trigger the change event
        dropdown.dispatchEvent(new Event('change'));

        // Wait for profile load or timeout
        await loadPromise;

        // Force a small delay to ensure connection is re-established
        await new Promise(resolve => setTimeout(resolve, 500));

        console.log('[BFValidator] Profile restored:', profileId);
        return true;
    } catch (error) {
        console.error('[BFValidator] Error restoring profile:', error);
        return false;
    }
}

/**
 * Run an async function with optional profile switching
 * Only switches profile if useValidatorProfile is enabled and validatorProfile is set
 * @param {Function} fn - Async function to execute
 * @param {object} settings - Extension settings
 * @returns {Promise<any>} Result of the function
 */
export async function runWithOptionalProfile(fn, settings) {
    // No profile switching needed - just run the function
    if (!settings.useValidatorProfile || !settings.validatorProfile) {
        return await fn();
    }

    // Switch to validator profile, run function, restore
    const originalProfile = getCurrentProfileId();
    const swapped = await swapProfile(settings.validatorProfile);

    if (swapped === false && getCurrentProfileId() !== settings.validatorProfile) {
        console.error('[BFValidator] Failed to switch to validator profile');
        // Still try to run without profile switch
        return await fn();
    }

    // Wait for profile to settle
    await new Promise(resolve => setTimeout(resolve, 500));

    try {
        return await fn();
    } finally {
        // Always restore original profile
        if (originalProfile && swapped !== false) {
            await restoreProfile(originalProfile);
        }
    }
}
