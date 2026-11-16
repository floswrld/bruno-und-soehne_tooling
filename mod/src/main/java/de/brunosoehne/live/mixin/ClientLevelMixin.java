package de.brunosoehne.live.mixin;

import de.brunosoehne.live.BrunoLive;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.core.BlockPos;
import net.minecraft.world.level.block.state.BlockState;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/**
 * Jeder geänderte Block im Client läuft hier durch. Zwei Wege: Was der Spieler selbst setzt (vorweggenommen) und was
 * eine Vorhersage bestätigt, geht über {@code setBlock}. Was der Server von sich aus schickt (andere Spieler, Befehle),
 * setzt {@code setServerVerifiedBlockState} mit {@code super.setBlock} direkt in Level, an {@code setBlock} hier vorbei.
 */
@Mixin(ClientLevel.class)
abstract class ClientLevelMixin {
	@Inject(method = "setBlock(Lnet/minecraft/core/BlockPos;Lnet/minecraft/world/level/block/state/BlockState;II)Z", at = @At("RETURN"))
	private void brunoLive$blockGeaendert(BlockPos pos, BlockState state, int flags, int rest, CallbackInfoReturnable<Boolean> cir) {
		if (cir.getReturnValueZ()) BrunoLive.blockGeaendert(pos);
	}

	@Inject(method = "setServerVerifiedBlockState(Lnet/minecraft/core/BlockPos;Lnet/minecraft/world/level/block/state/BlockState;I)V", at = @At("RETURN"))
	private void brunoLive$vomServer(BlockPos pos, BlockState state, int flags, CallbackInfo ci) {
		BrunoLive.blockGeaendert(pos);
	}
}
