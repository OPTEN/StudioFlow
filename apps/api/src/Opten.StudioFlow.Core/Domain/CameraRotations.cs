namespace Opten.StudioFlow.Core.Domain;

/// <summary>
/// Rules of the rotation that turns a camera picture upright: a phone held sideways while its screen stays upright (a
/// locked rotation) sends its picture sideways. The phone measures the correction itself (automatic), the Regie can fix
/// it per camera; the renderers turn the picture by the effective value before the rotation of the scene item.
/// </summary>
public static class CameraRotations
{
    /// <summary>True for 0, 90, 180 and 270.</summary>
    public static bool IsValid(int? rotation) => rotation is 0 or 90 or 180 or 270;

    /// <summary>
    /// The rotation applied to the picture: the one set in the Regie wins, else the one the phone reports, else none.
    /// Invalid values count as not set.
    /// </summary>
    public static int Effective(int? manual, int? reported) =>
        IsValid(manual) ? manual!.Value : IsValid(reported) ? reported!.Value : 0;
}
